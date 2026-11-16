require "json"
require "time"

module Skywake
  class Index
    include Handle

    UPSERT_ROWS = 10_000
    UPSERT_BYTES = 24 * 1024 * 1024
    PAGE = 1000

    def upsert(rows)
      batches = Batches.split(rows.is_a?(Hash) ? [rows] : rows, UPSERT_ROWS, UPSERT_BYTES) do |row|
        JSON.generate(row).bytesize
      end
      batches.each_with_object({ "ids" => [], "count" => 0 }) do |batch, done|
        written = post("/rows", batch, on_branch)
        done["ids"].concat(written["ids"])
        done["count"] += written["count"]
      end
    end

    def update(target, fields)
      patch("/rows", target_of(target).merge(fields: fields), on_branch)["count"]
    end

    def delete(target)
      post("/rows/delete", target_of(target), on_branch)["count"]
    end

    def get(id)
      @http.call("GET", "#{base}/rows/#{Http.segment(id)}", query: on_branch)
    rescue NotFound => e
      raise unless e.path == "id"
    end

    def query(text = nil, vector: nil, filter: nil, limit: nil, mode: nil, sort: nil, fields: nil)
      body = { text: text, vector: vector, filter: filter, limit: limit, mode: mode, sort: sort, fields: fields }
      post("/query", body.compact.merge(on_branch))["data"]
    end

    def count(filter: nil)
      post("/count", { filter: filter }.compact.merge(on_branch))["count"]
    end

    def aggregate(group_by: nil, count: nil, sum: nil, avg: nil, min: nil, max: nil, filter: nil)
      body = { group_by: group_by, count: count, sum: sum, avg: avg, min: min, max: max, filter: filter }
      post("/aggregate", body.compact.merge(on_branch))["data"]
    end

    def rows(filter: nil)
      return @http.pages("#{base}/rows", on_branch.merge(limit: PAGE)) if filter.nil?

      matching(filter)
    end

    def merge_into(into = MAIN)
      post("/merges", { from: @branch, into: into })
    end

    def versions
      @http.pages("#{base}/versions", on_branch).to_a
    end

    def restore(to)
      post("/restore", { to: to.is_a?(Time) ? to.utc.iso8601(3) : to }.merge(on_branch))
    end

    def copy(name, environment: nil)
      post("/copy", { name: name, environment: environment }.compact)
      Index.new(environment ? @http.within(environment) : @http, name)
    end

    def configure(read_only: nil, retention_days: nil, pinned: nil, attributes: nil, drop_attributes: nil)
      body = {
        read_only: read_only,
        retention_days: retention_days,
        pinned: pinned,
        attributes: attributes,
        drop_attributes: drop_attributes
      }
      patch("", body.compact)
    end

    private

    def collection
      "indexes"
    end

    def target_of(target)
      case target
      when String, Integer then { id: target }
      when Array then { ids: target }
      else
        named = target.transform_keys(&:to_s)
        named.keys == ["filter"] ? { filter: named["filter"] } : { filter: target }
      end
    end

    def matching(filter)
      Enumerator.new do |out|
        after = nil
        loop do
          where = after.nil? ? filter : { and: [filter, { id: { gt: after } }] }
          hits = query(filter: where, limit: PAGE)
          hits.each { |hit| out << hit.tap { |row| row.delete("score") } }
          break if hits.size < PAGE

          after = hits.last["id"]
        end
      end
    end
  end
end
