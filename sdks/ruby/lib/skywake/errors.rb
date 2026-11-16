require "json"

module Skywake
  class Error < StandardError
    attr_reader :status, :code, :hint, :request_id, :path

    def initialize(status, message, code: nil, hint: nil, request_id: nil, path: nil)
      super(hint ? "#{message}; #{hint}" : message)
      @status = status
      @code = code
      @hint = hint
      @request_id = request_id
      @path = path
    end
  end

  class AuthError < Error; end
  class PermissionError < Error; end
  class NotFound < Error; end
  class Conflict < Error; end
  class InvalidRequest < Error; end
  class ServerError < Error; end

  class MergeConflict < Conflict
    attr_reader :conflicts

    def initialize(status, message, conflicts: [], **fields)
      super(status, message, **fields)
      @conflicts = conflicts
    end
  end

  class RateLimited < Error
    attr_reader :retry_after

    def initialize(status, message, retry_after: nil, **fields)
      super(status, message, **fields)
      @retry_after = retry_after
    end
  end

  module Errors
    module_function

    def retry_after(headers)
      seconds = Float(headers["retry-after"], exception: false)
      seconds if seconds&.positive?
    end

    def from(response)
      error = details(response.body)
      fields = {
        code: error["code"],
        hint: error["hint"],
        request_id: error["request_id"] || response.headers["x-request-id"],
        path: error["path"]
      }
      build(response, error["message"] || "HTTP #{response.status}", error["conflicts"], fields)
    end

    def build(response, message, conflicts, fields)
      status = response.status
      case status
      when 401 then AuthError.new(status, message, **fields)
      when 403 then PermissionError.new(status, message, **fields)
      when 404 then NotFound.new(status, message, **fields)
      when 409
        return Conflict.new(status, message, **fields) if conflicts.nil? || conflicts.empty?

        MergeConflict.new(status, message, conflicts: conflicts, **fields)
      when 429 then RateLimited.new(status, message, retry_after: retry_after(response.headers), **fields)
      else (status >= 500 ? ServerError : InvalidRequest).new(status, message, **fields)
      end
    end

    def details(body)
      parsed = JSON.parse(body)
      return {} unless parsed.is_a?(Hash)

      raw = parsed["error"]
      raw.is_a?(Hash) ? raw : { "message" => raw, "code" => parsed["code"] }
    rescue JSON::ParserError
      {}
    end
  end
end
