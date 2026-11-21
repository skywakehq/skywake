require "minitest/autorun"
require "tmpdir"
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

  def app
    sky.disk("app")
  end

  def eventually
    100.times do
      found = yield
      return found if found

      sleep 0.2
    end
    yield
  end

  def test_01_with_only_skywake_api_key_set_whoami_shows_the_environment
    me = sky.whoami
    assert_equal "prod", me["environment"]
    assert_equal "admin", me["role"]
  end

  def test_02_a_file_written_to_a_new_disk_reads_back_and_is_listed
    app.write("README.md", "# App\n")
    assert_equal "# App\n", app.read("README.md")
    assert_equal [["README.md", "file"]], app.list.map { |entry| [entry["path"], entry["kind"]] }
  end

  def test_03_many_files_written_together_are_one_commit
    before = app.log.count
    app.write(
      { "src/a.ts" => "export const a = 1;\n", "src/b.ts" => "export const b = 2;\n", "notes.txt" => "hi" },
      message: "three files"
    )
    log = app.log.to_a
    assert_equal before + 1, log.size
    assert_equal "three files", log.first["message"]
  end

  def test_04_both_sides_changing_one_file_make_the_merge_a_merge_conflict
    work = app.fork("agent-1")
    work.write("notes.txt", "from the agent")
    app.write("notes.txt", "from main")
    error = assert_raises(Skywake::MergeConflict) { work.merge_into("main") }
    assert_equal ["notes.txt"], error.conflicts
    settled = work.merge_into("main", prefer: "theirs")
    assert settled["commit"]
    assert_equal "from the agent", app.read("notes.txt")
  end

  def test_05_grep_find_and_query_on_a_disk_find_a_file
    app.write("docs/coffee.md", "How to brew coffee at home.\n")
    assert_equal [["docs/coffee.md", 1]], app.grep("brew").map { |line| [line["path"], line["line"]] }
    assert_equal ["docs/coffee.md"], app.find("*.md", path: "docs").map { |entry| entry["path"] }
    hits = eventually do
      found = app.query("coffee")
      found if found.any? { |hit| hit["path"] == "docs/coffee.md" }
    end
    assert_equal "docs/coffee.md", hits.first["path"]
  end

  def test_06_read_with_at_returns_the_old_content_after_a_change
    old = app.head
    app.write("README.md", "# App, changed\n")
    assert_equal "# App\n", app.read("README.md", at: old)
    assert_equal "# App, changed\n", app.read("README.md")
  end

  def test_07_keys_stay_in_their_environment_and_their_role
    staging = Skywake.new(key: keys[:staging], environment: "prod")
    assert_raises(Skywake::PermissionError) { staging.disk("app").read("README.md") }
    reader = Skywake.new(key: keys[:read])
    assert_equal "# App, changed\n", reader.disk("app").read("README.md")
    assert_raises(Skywake::PermissionError) { reader.disk("app").write("x.md", "nope") }
  end

  def test_08_a_wrong_name_is_not_found_with_a_suggestion
    error = assert_raises(Skywake::NotFound) { sky.disk("ap").read("README.md") }
    assert_match(/`app`/, error.hint.to_s)
  end

  def test_09_destroying_a_branch_then_the_disk_empties_the_list
    app.on("agent-1").destroy
    assert_equal ["main"], app.branches.map { |branch| branch["name"] }
    app.destroy
    assert_equal [], sky.list_disks.map { |disk| disk["name"] }
  end

  def test_10_a_folder_goes_up_as_one_commit_and_comes_back_the_same
    Dir.mktmpdir("skywake-up-") do |dir|
      File.write(File.join(dir, "a.txt"), "alpha")
      File.binwrite(File.join(dir, "b.bin"), [0, 1, 2, 255].pack("C*"))
      site = sky.disk("site")
      site.upload(dir, message: "site")
      Dir.mktmpdir("skywake-down-") do |back|
        site.download(back)
        assert_equal "alpha", File.read(File.join(back, "a.txt"))
        assert_equal [0, 1, 2, 255], File.binread(File.join(back, "b.bin")).bytes
      end
      site.destroy
    end
  end
end
