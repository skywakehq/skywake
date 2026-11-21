module Skywake
  MAIN = "main".freeze

  module Handle
    attr_reader :name, :branch

    def initialize(http, name, branch = MAIN)
      @http = http
      @name = name
      @branch = branch
    end

    def on(branch)
      self.class.new(@http, @name, branch)
    end

    def fork(name, at: nil)
      @http.call("POST", "#{base}/branches", json: { name: name, from: @branch, at: at }.compact)
      on(name)
    end

    def destroy
      @http.call("DELETE", @branch == MAIN ? base : "#{base}/branches/#{Http.segment(@branch)}")
      nil
    end

    def branches
      @http.pages("#{base}/branches").to_a
    end

    def info
      @http.call("GET", base)
    end

    def inspect
      "#<#{self.class.name} #{@name} branch=#{@branch}>"
    end

    private

    def base
      "/#{collection}/#{Http.segment(@name)}"
    end

    def on_branch
      { branch: @branch }
    end

    def post(path, body, query = nil)
      @http.call("POST", "#{base}#{path}", query: query, json: body)
    end

    def patch(path, body)
      @http.call("PATCH", "#{base}#{path}", json: body)
    end
  end
end
