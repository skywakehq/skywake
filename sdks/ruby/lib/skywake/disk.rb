require "fileutils"
require "time"

module Skywake
  class Disk
    include Handle

    LIST_PAGE = 1000
    ROOT = { "path" => "", "kind" => "folder", "size" => 0, "modified" => nil, "executable" => false }.freeze

    def read(path, at: nil, offset: nil, length: nil, binary: false)
      data = file(path, on_branch.merge(at: at, offset: offset, length: length))
      binary ? data.b : data.dup.force_encoding(Encoding::UTF_8)
    end

    def write(target, content = nil, message: nil, executable: nil)
      files = target.is_a?(Hash) ? target : { target => content }
      commit(files.map { |path, body| change(clean(path), body.to_s.b, executable) }, message)
    end

    def commit(changes, message = nil)
      post("/commits", { changes: changes, message: message }.compact.merge(on_branch))
    end

    def part(data)
      @http.call("POST", "#{base}/uploads", bytes: data)["part"]
    end

    def delete(paths, message: nil)
      commit(Array(paths).map { |path| { path: clean(path), delete: true } }, message)
    end

    def move(from, to, message: nil)
      changes = [{ path: clean(to), from: { path: clean(from) } }, { path: clean(from), delete: true }]
      commit(changes, message || "Move #{clean(from)} to #{clean(to)}")
    end

    def entries(path = "", recursive: false, at: nil)
      query = { path: clean(path), recursive: recursive || nil, at: at, limit: LIST_PAGE }
      @http.pages("#{base}/files", query.merge(on_branch))
    end

    def list(path = "", recursive: false, at: nil)
      entries(path, recursive: recursive, at: at).to_a
    end

    def walk(path = "", at: nil)
      Enumerator.new do |out|
        entries(path, at: at).to_a.each do |entry|
          out << entry
          walk(entry["path"], at: at).each { |inner| out << inner } if entry["kind"] == "folder"
        end
      end
    end

    def stat(path, at: nil)
      target = clean(path)
      return ROOT.dup if target.empty?

      begin
        found = list(target.rpartition("/").first, at: at)
      rescue NotFound
        info
        return nil
      end
      found.find { |entry| entry["path"] == target }
    end

    def exists?(path, at: nil)
      !stat(path, at: at).nil?
    end

    def grep(pattern, path: nil, glob: nil, ignore_case: nil, limit: nil, at: nil)
      body = { pattern: pattern, path: path, glob: glob, ignore_case: ignore_case, limit: limit, at: at }
      post("/grep", body.compact.merge(on_branch))["data"]
    end

    def find(glob, path: nil, kind: nil, limit: nil, at: nil)
      post("/find", { glob: glob, path: path, kind: kind, limit: limit, at: at }.compact.merge(on_branch))["data"]
    end

    def query(text, limit: nil, path: nil)
      post("/query", { text: text, limit: limit, path: path }.compact.merge(on_branch))["data"]
    end

    def merge_into(into = MAIN, message: nil, dry_run: nil, prefer: nil)
      post("/merges", { from: @branch, into: into, message: message, dry_run: dry_run, prefer: prefer }.compact)
    end

    def head
      @http.call("GET", "#{base}/branches/#{Http.segment(@branch)}")["head"]
    end

    def log(path: nil, limit: nil)
      @http.pages("#{base}/commits", on_branch.merge(path: path, limit: limit))
    end

    def diff(against)
      @http.pages("#{base}/diff", on_branch.merge(against: against)).to_a
    end

    def revert(commit, message: nil)
      post("/revert", { commit: commit, message: message }.compact.merge(on_branch))
    end

    def restore(to)
      post("/restore", { to: to.is_a?(Time) ? commit_at(to) : to }.merge(on_branch))
    end

    def download(dir, at: nil)
      root = File.expand_path(dir)
      FileUtils.mkdir_p(root)
      at ||= head
      return nil unless at

      walk(at: at).each { |entry| place(root, entry, at) }
      at
    end

    def upload(dir, message: nil)
      files = Folders.local_files(File.expand_path(dir))
      batches = Batches.split(files, Changes::COMMIT_CHANGES, Changes::COMMIT_BYTES) do |name, local|
        Changes.weight(name, File.size(local))
      end
      done = batches.map { |batch| commit(batch.map { |name, local| local_change(name, local) }, message) }
      done.last&.[]("commit") || head
    end

    def configure(search: nil, visibility: nil)
      patch("", { search: search, visibility: visibility }.compact)
    end

    private

    def collection
      "disks"
    end

    def clean(path)
      path.to_s.gsub(%r{\A/+|/+\z}, "")
    end

    def file(path, query)
      @http.raw("GET", "#{base}/files/#{Http.file_path(path)}", query: query).body
    end

    def change(path, data, executable)
      return Changes.inline(path, data, executable) if data.bytesize <= Changes::INLINE_MAX

      Changes.uploaded(path, Changes.chunks(data).map { |chunk| part(chunk) }, executable)
    end

    def local_change(name, local)
      executable = Folders.executable?(local)
      return Changes.inline(name, File.binread(local), executable) if File.size(local) <= Changes::INLINE_MAX

      parts = []
      File.open(local, "rb") do |io|
        while (chunk = io.read(Changes::PART_MAX))
          parts << part(chunk)
        end
      end
      Changes.uploaded(name, parts, executable)
    end

    def place(root, entry, at)
      local = Folders.inside(root, entry["path"])
      case entry["kind"]
      when "folder" then FileUtils.mkdir_p(local)
      when "symlink" then Folders.link(local, entry["target"].to_s)
      else Folders.save(local, file(entry["path"], { at: at }), entry["executable"])
      end
    end

    def commit_at(time)
      found = log(limit: 1000).find { |commit| Time.iso8601(commit["created"]) <= time }
      raise ArgumentError, "disk `#{@name}` has no commit from #{time.iso8601} or before" unless found

      found["id"]
    end
  end
end
