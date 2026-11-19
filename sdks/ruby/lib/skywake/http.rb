require "erb"
require "json"
require "uri"

module Skywake
  class Http
    def self.segment(name)
      ERB::Util.url_encode(name.to_s)
    end

    def initialize(base, headers, transport)
      @base = base
      @headers = headers
      @transport = transport
    end

    def within(environment)
      Http.new(@base, @headers.merge("skywake-environment" => environment), @transport)
    end

    def call(method, path, query: nil, json: nil)
      headers = @headers.dup
      body = nil
      unless json.nil?
        headers["content-type"] = "application/json"
        body = JSON.generate(json)
      end
      response = @transport.deliver(method, uri(path, query), headers, body)
      raise Errors.from(response) if response.status >= 400

      body = response.body
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
