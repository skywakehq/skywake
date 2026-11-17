require "json"

module Skywake
  module Changes
    COMMIT_CHANGES = 10_000
    COMMIT_BYTES = 32 * 1024 * 1024
    INLINE_MAX = 4 * 1024 * 1024
    PART_MAX = 16 * 1024 * 1024

    module_function

    def base64_size(size)
      (size + 2) / 3 * 4
    end

    def weight(path, size)
      content = size > INLINE_MAX ? (size + PART_MAX - 1) / PART_MAX * 70 : base64_size(size)
      path.bytesize * 6 + 64 + content
    end

    def as_text(data)
      text = data.dup.force_encoding(Encoding::UTF_8)
      return nil unless text.valid_encoding?

      text if JSON.generate(text).bytesize <= base64_size(data.bytesize) + 2
    end

    def inline(path, data, executable = nil)
      text = as_text(data)
      change = text ? { path: path, text: text } : { path: path, base64: [data].pack("m0") }
      flagged(change, executable)
    end

    def uploaded(path, parts, executable = nil)
      flagged({ path: path, parts: parts }, executable)
    end

    def flagged(change, executable)
      executable.nil? ? change : change.merge(executable: executable)
    end

    def chunks(data)
      (0...data.bytesize).step(PART_MAX).map { |offset| data.byteslice(offset, PART_MAX) }
    end
  end
end
