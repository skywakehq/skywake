require "json"
require "minitest/autorun"
require "socket"
require "uri"
require "skywake"

class FakeApi
  Seen = Struct.new(:method, :path, :query, :headers, :body) do
    def json
      JSON.parse(body)
    end
  end

  attr_reader :seen

  def initialize(&handler)
    @seen = []
    @handler = handler
    @server = TCPServer.new("127.0.0.1", 0)
    @thread = Thread.new { loop { serve(@server.accept) } }
  end

  def url
    "http://127.0.0.1:#{@server.addr[1]}"
  end

  def sky(**options)
    Skywake.new(url: url, key: "k", backoff: 0.001, **options)
  end

  def close
    @thread.kill
    @server.close
  end

  private

  def serve(socket)
    one = receive(socket)
    @seen << one
    reply(socket, @handler.call(one, @seen.size))
  rescue StandardError => e
    warn(e.full_message)
  ensure
    socket.close
  end

  def receive(socket)
    method, target = socket.gets.split(" ")
    headers = {}
    while (line = socket.gets) && line != "\r\n"
      name, value = line.split(":", 2)
      headers[name.downcase] = value.strip
    end
    path, query = target.split("?", 2)
    body = socket.read(headers["content-length"].to_i) || ""
    Seen.new(method, path, URI.decode_www_form(query.to_s).to_h, headers, body)
  end

  def reply(socket, answer)
    payload = answer[:raw] || (answer.key?(:body) ? JSON.generate(answer[:body]) : "")
    head = {
      "content-type" => answer[:raw] ? "application/octet-stream" : "application/json",
      "content-length" => payload.bytesize,
      "connection" => "close"
    }.merge(answer.fetch(:headers, {}))
    lines = head.map { |name, value| "#{name}: #{value}\r\n" }.join
    socket.write("HTTP/1.1 #{answer.fetch(:status, 200)} Answer\r\n#{lines}\r\n#{payload}")
  end
end

class ApiTest < Minitest::Test
  def fake(&handler)
    @api = FakeApi.new(&handler)
  end

  def teardown
    @api&.close
  end

  def failure(status, code, **extra)
    { status: status, body: { error: { code: code, message: "nope", hint: nil, request_id: "req-1" }.merge(extra) } }
  end
end
