module Skywake
  # An error answer from the API.
  #
  # `code` says what kind of error it is, such as "not_found" or
  # "rate_limited". Quote `request_id` when you report a bug. For an
  # invalid request, `path` is the JSON path of the field that is wrong.
  class Error < StandardError
    attr_reader :status, :code, :request_id, :path

    def initialize(status, message, code: nil, request_id: nil, path: nil)
      super("#{status}: #{message}")
      @status = status
      @code = code
      @request_id = request_id
      @path = path
    end
  end
end
