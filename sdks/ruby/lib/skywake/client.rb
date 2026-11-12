require "erb"
require "json"
require "net/http"
require "uri"

module Skywake
  class Client
    # Sending these again has the same effect as sending them once.
    IDEMPOTENT = %w[GET HEAD PUT DELETE OPTIONS].freeze
    # The server asks for at most 60 seconds; waiting less would only be refused again.
    MAX_WAIT = 60.0
    NETWORK_ERRORS = [IOError, SystemCallError, SocketError, Timeout::Error, OpenSSL::SSL::SSLError].freeze

    Response = Struct.new(:status, :headers, :body)

    attr_reader :indexes

    # `key` is an API key (`sw_...`) or a console token. `timeout` is in
    # seconds: how long one try may wait to connect, and then for each piece
    # of the answer. Failed requests are tried up to `retries` more times
    # when that is safe, waiting about `backoff` seconds, doubled each time,
    # or as long as the server asks (at most 60 seconds).
    def initialize(url, key, timeout: 60.0, retries: 3, backoff: 0.2)
      # Every route lives under /v1.
      @base = "#{url.chomp('/').sub(%r{/v1\z}, '')}/v1"
      @key = key
      @timeout = timeout
      @retries = retries
      @backoff = backoff
      @indexes = Indexes.new(self)
    end

    # A search index, on its `main` branch.
    def index(name)
      SearchIndex.new(self, name)
    end

    # Sends a request and returns the parsed answer, or raises the API's
    # error. Fields of `body` set to nil are left out, so the server uses
    # its defaults. With a block, a successful answer is not read here but
    # handed to the block as it arrives.
    def call(method, path, body: nil, params: nil, &stream)
      response = request(method.to_s.upcase, path, body.is_a?(Hash) ? body.compact : body, params, stream)
      check(response)
      response.body.nil? || response.body.empty? ? nil : JSON.parse(response.body)
    end

    # Names may hold `/`. In a URL it must be `%2F`.
    def self.escape(name)
      ERB::Util.url_encode(name.to_s)
    end

    private

    # Sends again after network errors and 5xx answers when that is safe,
    # and after 429 always: the server refuses those before doing anything.
    #
    # A DELETE that failed that way may still have landed, so if a retry of
    # it then finds nothing (404), it answers 204: what it deleted is gone
    # either way.
    def request(method, path, body, params, stream)
      idempotent = IDEMPOTENT.include?(method)
      may_have_landed = false
      (0..@retries).each do |attempt|
        last = attempt == @retries
        begin
          response = perform(method, path, body, params, stream)
        rescue *NETWORK_ERRORS
          raise if last || !idempotent

          may_have_landed = true
          sleep(backoff(attempt))
          next
        end
        return Response.new(204, {}, nil) if may_have_landed && method == "DELETE" && response.status == 404

        again = response.status == 429 || (idempotent && response.status >= 500)
        return response if last || !again

        may_have_landed ||= response.status >= 500
        sleep([retry_after(response) || backoff(attempt), MAX_WAIT].min)
      end
    end

    def perform(method, path, body, params, stream)
      uri = URI("#{@base}#{path}")
      uri.query = URI.encode_www_form(params.compact) if params && !params.compact.empty?
      request = Net::HTTPGenericRequest.new(method, !body.nil?, true, uri.request_uri)
      request["Authorization"] = "Bearer #{@key}"
      request["Accept"] = "application/json"
      unless body.nil?
        request["Content-Type"] = "application/json"
        request.body = JSON.generate(body)
      end
      options = { use_ssl: uri.scheme == "https", open_timeout: @timeout, read_timeout: @timeout }
      Net::HTTP.start(uri.host, uri.port, **options) do |http|
        http.request(request) do |response|
          status = response.code.to_i
          if stream && status < 300
            stream.call(response)
            return Response.new(status, response.to_hash, nil)
          end
          return Response.new(status, response.to_hash, response.body)
        end
      end
    end

    def check(response)
      return if response.status < 300

      answer = begin
        JSON.parse(response.body.to_s)
      rescue JSON::ParserError
        nil
      end
      answer = {} unless answer.is_a?(Hash) && answer.key?("error")
      raise Error.new(
        response.status,
        answer.fetch("error", response.body),
        code: answer["code"],
        request_id: answer["request_id"] || response.headers["x-request-id"]&.first,
        path: answer["path"]
      )
    end

    # Full jitter, so many clients that failed together do not retry together.
    def backoff(attempt)
      rand * [MAX_WAIT, @backoff * 2**attempt].min
    end

    def retry_after(response)
      seconds = Float(response.headers["retry-after"]&.first, exception: false)
      seconds if seconds&.positive?
    end
  end
end
