require "erb"
require "json"
require "uri"

module Skywake
  class Http
    def self.segment(name)
      ERB::Util.url_encode(name.to_s)
    end

    def self.file_path(path)
      path.sub(%r{\A/+}, "").split("/", -1).map { |part| segment(part) }.join("/")
    end

    def initialize(base, headers, transport)
      @base = base
      @headers = headers
      @transport = transport
    end

    def raw(method, path, query: nil, json: nil, bytes: nil)
      headers = @headers.dup
      body = nil
      if !json.nil?
        headers["content-type"] = "application/json"
        body = JSON.generate(json)
      elsif bytes
        headers["content-type"] = "application/octet-stream"
        body = bytes
      end
      response = @transport.deliver(method, uri(path, query), headers, body)
      raise Errors.from(response) if response.status >= 400

      response
    end

    def call(method, path, **request)
      body = raw(method, path, **request).body
      body.empty? ? nil : JSON.parse(body.dup.force_encoding(Encoding::UTF_8))
    end

    def pages(path, query = {})
      Enumerator.new do |out|
        cursor = nil
        loop do
          page = call("GET", path, query: query.merge(cursor: cursor))
          page["data"].each { |item| out << item }
          break unless page["next"]

          cursor = page["next"]
        end
      end
    end

    private

    def uri(path, query)
      uri = URI("#{@base}#{path}")
      params = (query || {}).compact
      uri.query = URI.encode_www_form(params) unless params.empty?
      uri
    end
  end
end
