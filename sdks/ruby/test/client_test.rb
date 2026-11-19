require "helper"

class ClientTest < ApiTest
  def test_requests_go_to_v2_with_the_key_and_the_environment
    api = fake { { body: { organization: "acme", environment: "prod" } } }
    me = api.sky(environment: "prod").whoami
    assert_equal "prod", me["environment"]
    assert_equal "/v2/whoami", api.seen[0].path
    assert_equal "Bearer k", api.seen[0].headers["authorization"]
    assert_equal "prod", api.seen[0].headers["skywake-environment"]
  end

  def test_each_status_becomes_its_own_error_with_the_hint_in_the_message
    replies = [
      failure(401, "unauthorized"),
      failure(403, "forbidden"),
      failure(404, "not_found", hint: "did you mean `products`?"),
      failure(500, "internal")
    ]
    api = fake { |_, count| replies[[count, 4].min - 1] }
    sky = api.sky(retries: 0)
    assert_raises(Skywake::AuthError) { sky.whoami }
    assert_raises(Skywake::PermissionError) { sky.whoami }
    error = assert_raises(Skywake::NotFound) { sky.index("prodcts").info }
    assert_equal "did you mean `products`?", error.hint
    assert_match(/did you mean `products`\?/, error.message)
    assert_equal "req-1", error.request_id
    assert_equal 404, error.status
    assert_raises(Skywake::ServerError) { sky.whoami }
  end

  def test_a_429_is_retried_as_the_server_asks_then_reported_with_retry_after
    api = fake { failure(429, "rate_limited").merge(headers: { "retry-after" => "1" }) }
    error = assert_raises(Skywake::RateLimited) { api.sky(retries: 1).whoami }
    assert_equal 1, error.retry_after
    assert_equal 2, api.seen.size
  end

  def test_a_merge_that_cannot_finish_is_a_merge_conflict_listing_what_conflicts
    api = fake { failure(409, "conflict", conflicts: ["README.md"]) }
    work = api.sky.index("products", branch: "agent-1")
    error = assert_raises(Skywake::MergeConflict) { work.merge_into }
    assert_equal ["README.md"], error.conflicts
    assert_kind_of Skywake::Conflict, error
    assert_equal({ "from" => "agent-1", "into" => "main" }, api.seen[0].json)
  end

  def test_lists_follow_next_until_the_last_page
    api = fake do |seen|
      if seen.query["cursor"] == "b"
        { body: { data: [{ name: "c" }], next: nil } }
      else
        { body: { data: [{ name: "a" }, { name: "b" }], next: "b" } }
      end
    end
    indexes = api.sky.list_indexes
    assert_kind_of Enumerator, indexes
    assert_empty api.seen
    assert_equal %w[a b c], indexes.map { |index| index["name"] }
  end

  def test_upsert_takes_any_number_of_rows_and_sends_them_in_batches
    api = fake do |seen|
      rows = seen.json
      { body: { ids: rows.map { |row| row["id"] }, count: rows.size } }
    end
    rows = Array.new(25_000) { |id| { id: id, text: "row #{id}" } }
    done = api.sky.index("products").upsert(rows)
    assert_equal 25_000, done["count"]
    assert_equal 25_000, done["ids"].size
    assert_equal [10_000, 10_000, 5_000], api.seen.map { |seen| seen.json.size }
    assert_equal "main", api.seen[0].query["branch"]
  end

  def test_update_and_delete_take_an_id_ids_or_a_filter
    api = fake { { body: { count: 1 } } }
    products = api.sky.index("products")
    assert_equal 1, products.update(7, { stock: 3 })
    products.update({ tag: { eq: "sale" } }, { stock: 0 })
    products.delete([1, 2])
    products.delete({ filter: { stock: { eq: 0 } } })
    assert_equal(
      [
        ["PATCH", "/v2/indexes/products/rows", { "id" => 7, "fields" => { "stock" => 3 } }],
        ["PATCH", "/v2/indexes/products/rows",
         { "filter" => { "tag" => { "eq" => "sale" } }, "fields" => { "stock" => 0 } }],
        ["POST", "/v2/indexes/products/rows/delete", { "ids" => [1, 2] }],
        ["POST", "/v2/indexes/products/rows/delete", { "filter" => { "stock" => { "eq" => 0 } } }]
      ],
      api.seen.map { |seen| [seen.method, seen.path, seen.json] }
    )
  end

  def test_get_gives_nil_for_a_missing_row_but_raises_for_a_missing_index
    api = fake do |seen|
      if seen.path.include?("/rows/")
        failure(404, "not_found", path: "id")
      else
        failure(404, "not_found", hint: "did you mean `products`?")
      end
    end
    sky = api.sky
    assert_nil sky.index("products").get("a b")
    assert_equal "/v2/indexes/products/rows/a%20b", api.seen[0].path
    assert_raises(Skywake::NotFound) { sky.index("prodcts").info }
  end

  def test_query_takes_text_first_and_options_on_their_own
    api = fake { { body: { data: [{ id: 1, score: 0.9, title: "mug" }], next: nil } } }
    products = api.sky.index("products", branch: "draft")
    hit = products.query("coffee", limit: 3, mode: "keywords").first
    assert_equal "mug", hit["title"]
    products.query(filter: { price: { lt: 10 } }, sort: { price: "asc" })
    assert_equal({ "text" => "coffee", "limit" => 3, "mode" => "keywords", "branch" => "draft" }, api.seen[0].json)
    assert_equal(
      { "filter" => { "price" => { "lt" => 10 } }, "sort" => { "price" => "asc" }, "branch" => "draft" },
      api.seen[1].json
    )
  end

  def test_a_fork_is_a_handle_on_the_new_branch_and_destroy_removes_just_the_branch
    api = fake { |seen| seen.method == "DELETE" ? { status: 204 } : { status: 201, body: { name: "agent-1" } } }
    work = api.sky.index("products").fork("agent-1", at: "c3")
    assert_equal "agent-1", work.branch
    work.destroy
    assert_equal({ "name" => "agent-1", "from" => "main", "at" => "c3" }, api.seen[0].json)
    assert_equal ["DELETE", "/v2/indexes/products/branches/agent-1"], [api.seen[1].method, api.seen[1].path]
  end

  def test_a_delete_that_may_have_landed_counts_as_done_when_it_then_finds_nothing
    api = fake { |_, count| count == 1 ? failure(503, "unavailable") : failure(404, "not_found") }
    assert_nil api.sky.index("products").destroy
    assert_equal 2, api.seen.size
  end

  def test_a_post_is_not_retried_after_a_server_error
    api = fake { failure(500, "internal") }
    assert_raises(Skywake::ServerError) { api.sky.create_environment("prod") }
    assert_equal 1, api.seen.size
  end

  def test_create_key_sends_environment_even_when_nil
    api = fake { { status: 201, body: { id: "k1", key: "sw_x" } } }
    api.sky.create_key("ci", "read")
    assert_equal({ "name" => "ci", "role" => "read", "environment" => nil }, api.seen[0].json)
  end
end
