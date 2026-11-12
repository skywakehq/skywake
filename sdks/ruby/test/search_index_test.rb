require "helper"

class SearchIndexTest < ApiTest
  PERFORMANCE = { "server_ms" => 3, "cache_temperature" => "warm", "cache_hit_ratio" => 0.5 }.freeze

  def test_an_upsert_is_sent_1000_documents_at_a_time_to_the_branch_picked
    api = fake { |seen| [200, { count: seen.body["documents"].size }] }
    docs = (0...2500).map { |i| { id: i, vectors: { v: [i, 0] } } }
    assert_equal 2500, api.client.index("prod/products").at("agents/try").upsert(docs)
    assert_equal [1000, 1000, 500], api.seen.map { |seen| seen.body["documents"].size }
    assert_equal ["/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents"], api.seen.map(&:path).uniq
  end

  def test_a_query_leaves_out_what_is_not_given_and_gives_performance
    hits = [{ "id" => "a", "distance" => 0.1, "attributes" => {} }]
    api = fake { [200, { hits: hits, performance: PERFORMANCE, billing: { queries: 1 } }] }
    filter = { "price" => { "lt" => 10 } }
    found = api.client.index("products").query("embedding", [0.1, 0.2], top_k: 5, filter: filter)
    assert_equal hits, found
    assert_equal PERFORMANCE, found.performance
    assert_equal({ "queries" => 1 }, found.billing)
    assert_equal "/v1/indexes/products/branches/main/query", api.seen[0].path
    assert_equal({ "vector" => { "column" => "embedding", "value" => [0.1, 0.2] }, "topK" => 5, "filter" => filter },
                 api.seen[0].body)
  end

  def test_rank_and_multi_send_their_bodies_and_give_billing
    api = fake do |seen|
      field = seen.path.end_with?("/rank") ? "hits" : "results"
      [200, { field => [{ "id" => 1 }], billing: { queries: 1 } }]
    end
    index = api.client.index("docs")
    score = { "max_sim" => { "attribute" => "tokens", "vectors" => [[1, 0]] } }
    ranked = index.rank(score, top_k: 3)
    assert_equal [{ "id" => 1 }], ranked
    assert_equal({ "queries" => 1 }, ranked.billing)
    assert_equal({ "score" => score, "topK" => 3 }, api.seen[0].body)
    index.multi([{ rank: { score: score } }], consistency: "eventual")
    assert_equal({ "requests" => [{ "rank" => { "score" => score } }], "consistency" => "eventual" }, api.seen[1].body)
  end

  def test_hybrid_puts_k_and_weights_in_fuse
    api = fake { [200, { hits: [] }] }
    api.client.index("docs").hybrid({ "words" => { "query" => "reset" } }, k: 30)
    assert_equal({ "searches" => { "words" => { "query" => "reset" } }, "topK" => 10, "fuse" => { "k" => 30 } },
                 api.seen[0].body)
  end

  def test_export_streams_one_document_a_line
    lines = (1..3).map { |i| JSON.generate(id: i) }.join("\n") + "\n"
    api = fake { [200, lines, { "content-type" => "application/x-ndjson" }] }
    assert_equal [1, 2, 3], api.client.index("docs").export.map { |doc| doc["id"] }
  end

  def test_documents_and_branches_are_paged
    api = fake do |seen|
      if seen.path.end_with?("/documents")
        cursor = seen.query.to_s.include?("cursor=") ? nil : "next"
        [200, { documents: [{ id: cursor ? 1 : 2 }], next: cursor }]
      else
        names = seen.query.to_s.include?("after=") ? ["z"] : (0...1000).map { |i| format("b%04d", i) }
        [200, names.map { |name| { name: name } }]
      end
    end
    index = api.client.index("docs")
    assert_equal [1, 2], index.each_document.map { |doc| doc["id"] }
    assert_equal 1001, index.each_branch.count
    assert_equal "limit=1000&after=b0999", api.seen.last.query
  end

  def test_branch_and_operation_routes
    api = fake do |seen|
      case seen.path
      when %r{/merge\z} then [200, { rows: 2 }]
      when %r{/(build|warm)\z} then [202, { id: "op_1", status: "running" }]
      when %r{/branches\z} then [201, { name: "agents/x" }]
      else [200, { id: "op_1" }]
      end
    end
    main = api.client.index("products")
    fork = main.fork("agents/x")
    assert_equal "op_1", fork.build["id"]
    fork.warm
    fork.operation("op_1")
    assert_equal 2, main.merge("agents/x")
    assert_equal(
      ["POST /v1/indexes/products/branches", "POST /v1/indexes/products/branches/agents%2Fx/build",
       "POST /v1/indexes/products/branches/agents%2Fx/warm", "GET /v1/indexes/products/operations/op_1",
       "POST /v1/indexes/products/branches/main/merge"],
      api.seen.map { |seen| "#{seen.method} #{seen.path}" }
    )
    assert_equal({ "name" => "agents/x", "from" => "main" }, api.seen[0].body)
  end

  def test_indexes_are_made_paged_and_updated
    api = fake do |seen|
      next [201, seen.body] if seen.method == "POST"

      seen.query.to_s.include?("after=") ? [200, [{ name: "z" }]] : [200, (0...1000).map { |i| { name: "i#{i}" } }]
    end
    api.client.indexes.create("a", vectors: [{ name: "v", dims: 2 }])
    assert_equal({ "name" => "a", "schema" => { "vectors" => [{ "name" => "v", "dims" => 2 }], "attributes" => [] } },
                 api.seen[0].body)
    assert_equal 1001, api.client.indexes.count
  end

  def test_a_write_asks_for_the_ids_it_changed_and_an_index_may_take_uuid_ids
    api = fake { |seen| seen.path == "/v1/indexes" ? [201, seen.body] : [200, { deleted_ids: [1] }] }
    counts = api.client.index("a").write(deletes: [1], return_affected_ids: true)
    assert_equal [1], counts["deleted_ids"]
    assert_equal({ "deletes" => [1], "returnAffectedIds" => true }, api.seen[0].body)
    api.client.indexes.create("b", vectors: [{ name: "v", dims: 1 }], id_type: "uuid")
    assert_equal({ "vectors" => [{ "name" => "v", "dims" => 1 }], "attributes" => [], "id" => "uuid" },
                 api.seen[1].body["schema"])
  end

  def test_versions_restore_fork_at_collect_parquet_and_retention_routes
    version = "a" * 64
    api = fake do |seen|
      case seen.path
      when %r{/versions\z} then [200, [{ version: version, rows: 1 }]]
      when %r{/restore\z} then [200, { version: version, rows: 1 }]
      when %r{/collect\z} then [202, { id: "op_2" }]
      when %r{/export\z} then [200, "PAR1", { "content-type" => "application/vnd.apache.parquet" }]
      else [201, { name: "past" }]
      end
    end
    main = api.client.index("products")
    assert_equal 1, main.versions(limit: 5, after: version)[0]["rows"]
    assert_equal version, main.restore(version)["version"]
    assert_equal "past", main.fork("past", version: version).branch
    assert_equal "op_2", main.collect["id"]
    assert_equal "PAR1", main.export_parquet.to_a.join
    api.client.indexes.update("products", retention_days: 7)
    api.client.indexes.update("products", retention_days: :all)
    assert_equal(
      ["GET /v1/indexes/products/branches/main/versions limit=5&after=#{version}",
       "POST /v1/indexes/products/branches/main/restore ", "POST /v1/indexes/products/branches ",
       "POST /v1/indexes/products/collect ", "GET /v1/indexes/products/branches/main/export format=parquet",
       "PATCH /v1/indexes/products ", "PATCH /v1/indexes/products "],
      api.seen.map { |seen| "#{seen.method} #{seen.path} #{seen.query}" }
    )
    assert_equal({ "version" => version }, api.seen[1].body)
    assert_equal({ "name" => "past", "from" => "main", "at" => version }, api.seen[2].body)
    assert_equal({ "retention_days" => 7 }, api.seen[5].body)
    assert_equal({ "retention_days" => nil }, api.seen[6].body)
  end

  def test_an_index_is_pinned_unpinned_and_says_where
    pinning = { "replicas" => [{ "server" => "api-1", "warm" => true, "in_flight" => 2 }] }
    api = fake { [200, { name: "a", pinned: { replicas: 1 }, pinning: pinning }] }
    api.client.indexes.create("a", vectors: [{ name: "v", dims: 3 }], replicas: 2)
    assert_equal({ "replicas" => 2 }, api.seen[0].body["pinned"])
    api.client.indexes.update("a", replicas: 3)
    assert_equal({ "pinned" => { "replicas" => 3 } }, api.seen[1].body)
    api.client.indexes.update("a", replicas: :none)
    assert_equal({ "pinned" => nil }, api.seen[2].body)
    info = api.client.indexes.get("a")
    assert_equal({ "replicas" => 1 }, info["pinned"])
    assert_equal pinning, info["pinning"]
  end
end
