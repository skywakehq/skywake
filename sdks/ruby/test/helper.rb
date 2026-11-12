require "json"
require "minitest/autorun"
require "webrick"
require "skywake"

# A local server that answers with `answer.call(request)`, which returns
# [status, body] or [status, body, headers], and keeps every request it saw.
class FakeApi
  class Handler < WEBrick::HTTPServlet::AbstractServlet
    def service(request, response)
      @options.first.call(request, response)
    end
  end

  Seen = Struct.new(:method, :path, :query, :body)

  attr_reader :seen, :client

  def initialize(&answer)
    @seen = []
    @server = WEBrick::HTTPServer.new(Port: 0, Logger: WEBrick::Log.new(File::NULL), AccessLog: [])
    # A servlet of its own: mount_proc answers only GET and POST.
    @server.mount("/", Handler, lambda do |request, response|
      body = request.body && JSON.parse(request.body)
      seen = Seen.new(request.request_method, request.unparsed_uri.split("?").first, request.query_string, body)
      @seen << seen
      status, answer_body, headers = answer.call(seen)
      response.status = status
      (headers || {}).each { |name, value| response[name] = value }
      response.body = answer_body.is_a?(String) ? answer_body : JSON.generate(answer_body) unless answer_body.nil?
    end)
    @thread = Thread.new { @server.start }
    @client = Skywake::Client.new("http://127.0.0.1:#{@server.config[:Port]}/v1", "sw_key", backoff: 0.001)
  end

  def close
    @server.shutdown
    @thread.join
  end
end

class ApiTest < Minitest::Test
  def fake(&answer)
    @api = FakeApi.new(&answer)
  end

  def teardown
    @api&.close
  end
end
