require "helper"

class ClientTest < ApiTest
  def test_a_429_is_retried_after_the_wait_the_server_asks_for
    api = fake do
      api.seen.size == 1 ? [429, { error: "slow down" }, { "retry-after" => "0.01" }] : [200, { count: 1 }]
    end
    assert_equal 1, api.client.index("docs").upsert([{ id: 1, vectors: { v: [0] } }])
    assert_equal 2, api.seen.size
  end

  def test_a_5xx_is_not_retried_for_a_post
    api = fake { [503, { error: "down" }] }
    error = assert_raises(Skywake::Error) { api.client.index("docs").upsert([{ id: 1 }]) }
    assert_equal 503, error.status
    assert_equal 1, api.seen.size
  end

  def test_a_delete_retried_to_a_404_has_done_its_work
    api = fake { |seen| api.seen.size == 1 ? [503, { error: "down" }] : [404, { error: "gone" }] }
    assert_nil api.client.index("docs").at("x").delete_branch
    assert_equal 2, api.seen.size
  end

  def test_errors_say_what_is_wrong_and_where
    answer = { error: "must be a number", code: "invalid", request_id: "req-1", path: "filter.price.lt" }
    api = fake { [400, answer] }
    error = assert_raises(Skywake::Error) { api.client.index("docs").query("v", [0]) }
    assert_equal [400, "invalid", "req-1", "filter.price.lt"], [error.status, error.code, error.request_id, error.path]
    assert_equal "400: must be a number", error.message
  end

  def test_an_answer_that_is_not_json_still_raises
    api = fake { [502, "bad gateway", { "x-request-id" => "req-2" }] }
    error = assert_raises(Skywake::Error) { api.client.indexes.update("docs", read_only: true) }
    assert_equal ["502: bad gateway", "req-2"], [error.message, error.request_id]
  end
end
