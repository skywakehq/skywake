require "json"
require "skywake/paging"
require "skywake/results"
require "skywake/routes"
require "skywake/indexes"

module Skywake
  # One branch of a search index: `main` unless `at` picked another.
  class SearchIndex
    attr_reader :name, :branch

    def initialize(sky, name, branch = "main")
      @sky = sky
      @name = name
      @branch = branch
      @path = Routes.index(name)
      @branch_path = "#{@path}/branches/#{Client.escape(branch)}"
    end

    # The same index on another branch.
    def at(branch)
      SearchIndex.new(@sky, @name, branch)
    end

    # Writes documents, 1000 to a request. Each replaces any earlier one
    # with its id. A document is {"id", "vectors" => {column => [...]},
    # "attributes" => {...}}. A vector may be text, or {"image" => url},
    # when its column has "embed": the server embeds it.
    def upsert(documents)
      batched(documents) { |part| post("documents", documents: part)["count"] }
    end

    # Deletes documents by id. Ids that are not there are ignored.
    def delete(ids)
      batched(ids) { |part| post("documents/delete", ids: part)["count"] }
    end

    # Upserts, patches and deletes as one change, in this order: `delete_by`,
    # `patch_by`, `upserts`, `patches`, `deletes`. A patch is {"id",
    # "attributes"}, where nil removes an attribute; `patch_by` is {"filter",
    # "attributes"}. A condition is a filter checked against each document
    # as it was, whose values may be {"$ref_new" => attribute}. Returns
    # {"upserted", "patched", "deleted"}, and with `return_affected_ids`
    # also "upserted_ids", "patched_ids" and "deleted_ids".
    def write(upserts: nil, patches: nil, deletes: nil, upsert_if: nil, patch_if: nil, delete_if: nil,
              delete_by: nil, patch_by: nil, return_affected_ids: false)
      post("write", upserts: upserts, patches: patches, deletes: deletes, upsertIf: upsert_if,
                    patchIf: patch_if, deleteIf: delete_if, deleteBy: delete_by, patchBy: patch_by,
                    returnAffectedIds: return_affected_ids || nil)
    end

    # Sets attributes of documents, 1000 to a request; nil removes one.
    # Missing documents are skipped. Returns how many were patched.
    def patch(patches)
      batched(patches) { |part| write(patches: part)["patched"] }
    end

    # Deletes every document that passes `filter`; returns how many.
    def delete_by(filter)
      write(delete_by: filter)["deleted"]
    end

    # Documents in the order of an attribute, or of "id"; those without it
    # come last.
    def order(by, descending: false, top_k: 10, offset: nil, filter: nil, include: nil, exclude: nil,
              consistency: nil)
      read("order", "rows", by: by, descending: descending, topK: top_k, offset: offset, filter: filter,
                            include: include, exclude: exclude, consistency: consistency)
    end

    # Every document that passes `filter`, best first by an exact score,
    # such as {"dot" => {"attribute", "indices", "values"}} for sparse
    # vectors or {"max_sim" => {"attribute", "vectors"}} for late
    # interaction. Those scoring 0 are left out.
    def rank(score, top_k: 10, offset: nil, filter: nil, include: nil, exclude: nil, consistency: nil)
      read("rank", "hits", score: score, topK: top_k, offset: offset, filter: filter, include: include,
                           exclude: exclude, consistency: consistency)
    end

    # Measures over the documents that pass `filter`, in one group or a
    # group per set of `group_by` values. Each measure is named, such as
    # {"total" => ["count"], "revenue" => ["sum", "price"]}; the others are
    # "avg", "min" and "max". Returns [{"key", "values"}].
    def aggregate(measures, group_by: nil, filter: nil, consistency: nil)
      read("aggregate", "groups", measures: measures, groupBy: group_by, filter: filter, consistency: consistency)
    end

    # Several requests on one snapshot, each one of {"query" => ...},
    # {"search" => ...}, {"hybrid" => ...}, {"order" => ...}, {"rank" => ...}
    # or {"aggregate" => ...} with the API's request body. Each result is in
    # the field it was asked in.
    def multi(requests, consistency: nil)
      read("multi", "results", requests: requests, consistency: consistency)
    end

    # Every document as it is now, streamed, in no set order.
    def export
      return enum_for(:export) unless block_given?

      @sky.call(:get, "#{@branch_path}/export") do |response|
        rest = ""
        response.read_body do |chunk|
          lines = (rest + chunk).split("\n", -1)
          rest = lines.pop || ""
          lines.each { |line| yield JSON.parse(line) unless line.empty? }
        end
        yield JSON.parse(rest) unless rest.empty?
      end
    end

    # Every document as it is now, as the bytes of a Parquet file, given to
    # the block a chunk at a time as they come.
    def export_parquet(&block)
      return enum_for(:export_parquet) unless block

      @sky.call(:get, "#{@branch_path}/export", params: { format: "parquet" }) do |response|
        response.read_body(&block)
      end
      nil
    end

    # Copies this branch to a new index `name`, as its `main`.
    def copy(name, region: nil, kms_key_id: nil)
      @sky.call(:post, "#{@path}/copy", body: { name: name, branch: @branch, region: region,
                                                encryption: Routes.encryption(kms_key_id) })
      SearchIndex.new(@sky, name)
    end

    # The `top_k` nearest documents to `vector` in `column` that pass
    # `filter`, nearest first. A filter is keyword objects, such as
    # {"and" => [{"tag" => {"eq" => "billing"}}, {"price" => {"lt" => 10}}]};
    # {"id" => {"in" => [...]}} filters by id. `include` names the attributes
    # to return, or `exclude` those to leave out. `per`, such as
    # {"attributes" => ["file"], "limit" => 3}, keeps at most `limit` hits
    # for each value. `consistency: "eventual"` may read what the server saw
    # up to a minute ago, which is faster. `recall` is the share of the true
    # nearest to find, from 0 to 1 (0.95 by default; 1 reads every cluster
    # and returns exactly the true nearest by the column's metric); `probe`
    # overrides it with a number of clusters to read. `vector` may be text
    # when the column has "embed". `rerank`, such as {"model" =>
    # "rerank-v3.5", "field" => "body", "topN" => 5}, orders the hits again
    # with a rerank model.
    def query(column, vector, top_k: 10, probe: nil, filter: nil, include: nil, recall: nil, offset: nil,
              rerank: nil, exclude: nil, per: nil, consistency: nil)
      read("query", "hits", vector: { column: column, value: vector }, topK: top_k, recall: recall, probe: probe,
                            filter: filter, include: include, exclude: exclude, offset: offset, per: per,
                            consistency: consistency, rerank: rerank)
    end

    # The `top_k` documents that best match `query` by BM25, best first,
    # each with its `score`. `fields` are the text attributes to search
    # (every one by default) and `boosts` a weight per field. `k1` and `b`
    # override BM25's parameters. `highlight` names text attributes to
    # return the best fragment of. `fuzzy` (1 or 2) also matches words that
    # many typos away. The others are as in `query`.
    def search(query, top_k: 10, fields: nil, boosts: nil, k1: nil, b: nil, filter: nil, include: nil,
               highlight: nil, offset: nil, rerank: nil, exclude: nil, per: nil, consistency: nil, fuzzy: nil)
      read("search", "hits", query: query, topK: top_k, fields: fields, boosts: boosts, k1: k1, b: b,
                             filter: filter, include: include, exclude: exclude, highlight: highlight,
                             fuzzy: fuzzy, offset: offset, per: per, consistency: consistency, rerank: rerank)
    end

    # Named searches on one snapshot, fused by reciprocal rank. Each search
    # is a query body (with "vector") or a search body (with "query"). A hit
    # scores the sum of weight / (k + rank); `k` is 60 and weights are 1 by
    # default. `rank` scores the hits by an expression instead, such as
    # {"sum" => [{"search" => "title"}, {"search" => "body"}]}.
    def hybrid(searches, top_k: 10, k: nil, weights: nil, offset: nil, rerank: nil, per: nil, consistency: nil,
               rank: nil)
      read("hybrid", "hits", searches: searches, topK: top_k, fuse: { k: k, weights: weights }.compact,
                             offset: offset, per: per, consistency: consistency, rank: rank, rerank: rerank)
    end

    # The document with `id`. A missing one raises Skywake::Error with
    # status 404, as a missing index or branch does.
    def get(id)
      @sky.call(:get, "#{@branch_path}/documents/#{Client.escape(id)}")
    end

    # One page of documents by id, number ids first: {"documents", "next"}.
    # Pass `next` as `cursor` for the next page. It reads every segment, so
    # it is for browsing.
    def documents(limit: nil, cursor: nil)
      @sky.call(:get, "#{@branch_path}/documents", params: { limit: limit, cursor: cursor })
    end

    # Every document, a page at a time.
    def each_document
      return enum_for(:each_document) unless block_given?

      cursor = nil
      loop do
        page = documents(limit: BATCH, cursor: cursor)
        page["documents"].each { |document| yield document }
        cursor = page["next"]
        break unless cursor
      end
    end

    # Forks this branch as `name`, at its head or at an older `version`.
    # Nothing is copied.
    def fork(name, version: nil)
      @sky.call(:post, "#{@path}/branches", body: { name: name, from: @branch, at: version })
      at(name)
    end

    # One page of this branch's versions, newest first: one for every change.
    def versions(limit: nil, after: nil)
      @sky.call(:get, "#{@branch_path}/versions", params: { limit: limit, after: after })
    end

    # Moves this branch back to an older version, as a new version, which it
    # returns. The history stays.
    def restore(version)
      post("restore", version: version)
    end

    # Starts deleting the data of the whole index that no branch uses, nor
    # any version within its `retention_days`. Returns the operation.
    def collect
      @sky.call(:post, "#{@path}/collect", body: {})
    end

    # This branch's counts, or nil while the server cannot count them.
    def stats
      @sky.call(:get, @branch_path)["stats"]
    end

    # Starts clustering this branch's rows. It answers before the build
    # ends, with an operation `operation(id)` follows.
    def build
      post("build")
    end

    # Adds the writes of `branch` since it forked, or was last merged here,
    # to this branch, and returns how many it added. Where both wrote one
    # document, `branch`'s write wins.
    def merge(branch)
      post("merge", from: branch)["rows"]
    end

    # Starts reading this branch into the cache, so the next queries are
    # fast. Returns the operation.
    def warm
      post("warm")
    end

    # A build or warming of this index, and how it went.
    def operation(id)
      @sky.call(:get, "#{@path}/operations/#{Client.escape(id)}")
    end

    # How many of the true nearest documents queries find: queries with the
    # vectors of `queries` documents picked at random, as asked and exactly,
    # and compares them.
    def recall(column: nil, queries: nil, top_k: nil, recall: nil, filter: nil)
      post("recall", column: column, queries: queries, topK: top_k, recall: recall, filter: filter)
    end

    # One page of the index's branches, in name order.
    def branches(limit: nil, after: nil)
      @sky.call(:get, "#{@path}/branches", params: { limit: limit, after: after })
    end

    # Every branch, a page at a time.
    def each_branch(&block)
      Skywake.every("name") { |limit, after| branches(limit: limit, after: after) }.each(&block)
    end

    # Deletes this branch. `main` stays while the index does.
    def delete_branch
      @sky.call(:delete, @branch_path)
      nil
    end

    private

    def post(route, body = {})
      @sky.call(:post, "#{@branch_path}/#{route}", body: body)
    end

    def read(route, field, body)
      Results.of(post(route, body), field)
    end

    def batched(items)
      items.each_slice(BATCH).sum { |part| yield part }
    end
  end
end
