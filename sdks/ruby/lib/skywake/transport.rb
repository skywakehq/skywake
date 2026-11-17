require "net/http"
require "openssl"

module Skywake
  class Transport
    IDEMPOTENT = %w[GET HEAD PUT DELETE OPTIONS].freeze
    MAX_WAIT = 60.0
    NETWORK_ERRORS = [IOError, SystemCallError, SocketError, Timeout::Error, OpenSSL::SSL::SSLError].freeze

    Response = Struct.new(:status, :headers, :body)

    def initialize(timeout:, retries:, backoff:)
      @timeout = timeout
      @retries = retries
      @backoff = backoff
    end

    def deliver(method, uri, headers, body)
      idempotent = IDEMPOTENT.include?(method)
      landed = false
      (0..@retries).each do |attempt|
        last = attempt == @retries
        begin
          response = perform(method, uri, headers, body)
        rescue *NETWORK_ERRORS
          raise if last || !idempotent

          landed = true
          sleep(backoff(attempt))
          next
        end
        return Response.new(204, response.headers, "") if landed && method == "DELETE" && response.status == 404
        return response if last || !again?(response, idempotent)

        landed ||= response.status >= 500
        sleep(wait_after(response, attempt))
      end
    end

    private

    def perform(method, uri, headers, body)
      request = Net::HTTPGenericRequest.new(method, !body.nil?, true, uri.request_uri, headers)
      request.body = body
      options = { use_ssl: uri.scheme == "https", open_timeout: @timeout, read_timeout: @timeout }
      Net::HTTP.start(uri.host, uri.port, **options) do |http|
        response = http.request(request)
        Response.new(response.code.to_i, response.each_header.to_h, response.body || +"")
      end
    end

    def again?(response, idempotent)
      response.status == 429 || (idempotent && response.status >= 500)
    end

    def wait_after(response, attempt)
      [Errors.retry_after(response.headers) || backoff(attempt), MAX_WAIT].min
    end

    def backoff(attempt)
      rand * [MAX_WAIT, @backoff * 2**attempt].min
    end
  end
end
