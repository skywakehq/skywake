require "minitest/autorun"
require "skywake"

class ScenariosTest < Minitest::Test
  i_suck_and_my_tests_are_order_dependent!

  URL = ENV.fetch("SKYWAKE_SCENARIO_URL", nil)
  ADMIN = ENV.fetch("SKYWAKE_SCENARIO_KEY", nil)
  STATE = {}

  def setup
    skip "needs SKYWAKE_SCENARIO_URL and SKYWAKE_SCENARIO_KEY" unless URL && ADMIN
    STATE[:keys] ||= prepare
  end

  def prepare
    org = Skywake.new(url: URL, key: ADMIN)
    %w[prod staging].each do |name|
      org.create_environment(name)
    rescue Skywake::Conflict
      nil
    end
    keys = {
      prod: org.create_key("prod", "admin", environment: "prod")["key"],
      staging: org.create_key("staging", "admin", environment: "staging")["key"],
      read: org.create_key("reader", "read", environment: "prod")["key"]
    }
    %w[SKYWAKE_KEY SKYWAKE_ENV SKYWAKE_PROFILE].each { |name| ENV.delete(name) }
    ENV["SKYWAKE_URL"] = URL
    ENV["SKYWAKE_API_KEY"] = keys[:prod]
    keys
  end

  def keys
    STATE[:keys]
  end

  def sky
    STATE[:sky] ||= Skywake.new
  end

  def products
    sky.index("products")
  end

  def test_01_with_only_skywake_api_key_set_whoami_shows_the_environment
    me = sky.whoami
    assert_equal "prod", me["environment"]
    assert_equal "admin", me["role"]
  end

  def test_02_one_row_upserted_to_a_new_index_with_no_schema_is_found_by_query
    products.upsert({ id: "mug", text: "a blue coffee mug", price: 12, tags: ["kitchen"] })
    hit = products.query("coffee mug").first
    assert_equal "mug", hit["id"]
    assert_equal 12, hit["price"]
    assert_operator hit["score"], :>, 0
  end

  def test_03_ten_thousand_rows_upserted_in_one_call_are_all_counted
    rows = Array.new(10_000) do |i|
      { id: "row-#{i}", text: i.odd? ? "running shoe number #{i}" : "invoice #{i}", price: i % 100,
        tags: [i.odd? ? "shoes" : "billing"] }
    end
    bulk = sky.index("bulk")
    assert_equal 10_000, bulk.upsert(rows)["count"]
    assert_equal 10_000, bulk.count
    assert_equal 5_000, bulk.count(filter: { tags: { contains: "shoes" } })
  end

  def test_04_a_query_takes_a_filter_a_limit_and_keywords_mode
    hits = sky.index("bulk").query("shoe", mode: "keywords", filter: { price: { lt: 10 } }, limit: 3)
    assert_equal 3, hits.size
    hits.each do |hit|
      assert_operator hit["price"], :<, 10
      assert_match(/shoe/, hit["text"])
    end
  end

  def test_05_update_shows_in_get_and_delete_makes_get_nil
    assert_equal 1, products.update("mug", { price: 9 })
    assert_equal 9, products.get("mug")["price"]
    assert_equal 1, products.delete("mug")
    assert_nil products.get("mug")
  end

  def test_06_a_fork_changes_apart_from_main_and_merging_brings_the_change
    products.upsert({ id: "cup", text: "a white coffee cup", price: 5 })
    draft = products.fork("draft")
    draft.update("cup", { price: 7 })
    assert_equal 7, draft.query("coffee cup").first["price"]
    assert_equal 5, products.query("coffee cup").first["price"]
    draft.merge_into("main")
    assert_equal 7, products.get("cup")["price"]
  end

  def test_07_keys_stay_in_their_environment_and_their_role
    staging = Skywake.new(key: keys[:staging], environment: "prod")
    assert_raises(Skywake::PermissionError) { staging.index("products").query("coffee") }
    reader = Skywake.new(key: keys[:read])
    assert_equal 7, reader.index("products").get("cup")["price"]
    assert_raises(Skywake::PermissionError) { reader.index("products").upsert({ id: "x", text: "nope" }) }
  end

  def test_08_a_wrong_name_is_not_found_with_a_suggestion
    error = assert_raises(Skywake::NotFound) { sky.index("prodcts").query("coffee") }
    assert_match(/products/, error.hint.to_s)
  end

  def test_09_destroying_a_branch_then_the_indexes_empties_the_list
    products.on("draft").destroy
    assert_equal ["main"], products.branches.map { |branch| branch["name"] }
    %w[products bulk].each { |name| sky.index(name).destroy }
    assert_equal [], sky.list_indexes.map { |index| index["name"] }
  end
end
