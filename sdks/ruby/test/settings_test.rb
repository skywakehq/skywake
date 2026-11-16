require "helper"
require "fileutils"
require "tmpdir"

class SettingsTest < ApiTest
  NAMES = %w[SKYWAKE_API_KEY SKYWAKE_KEY SKYWAKE_URL SKYWAKE_ENV SKYWAKE_PROFILE XDG_CONFIG_HOME].freeze

  def setup
    @saved = NAMES.to_h { |name| [name, ENV.delete(name)] }
    @dir = Dir.mktmpdir("skywake-settings-")
    ENV["XDG_CONFIG_HOME"] = @dir
  end

  def teardown
    super
    @saved.each { |name, value| ENV[name] = value }
    FileUtils.rm_rf(@dir)
  end

  def credentials(text)
    FileUtils.mkdir_p(File.join(@dir, "skywake"))
    File.write(File.join(@dir, "skywake", "credentials.toml"), text)
  end

  def echo
    fake { { body: { organization: "o", environment: "prod" } } }
  end

  def test_with_nothing_set_the_error_says_how_to_sign_in
    error = assert_raises(ArgumentError) { Skywake.new }
    assert_match(/skywake login/, error.message)
  end

  def test_the_key_and_url_come_from_the_environment_and_the_url_defaults_to_the_cloud
    ENV["SKYWAKE_API_KEY"] = "sw_env"
    assert_equal "https://api.skywake.dev", Skywake.new.url
    ENV["SKYWAKE_URL"] = "http://localhost:8080/"
    assert_equal "http://localhost:8080", Skywake.new.url
  end

  def test_a_profile_from_the_credentials_file_is_used_when_no_key_is_given
    api = echo
    credentials(<<~TOML)
      [default]
      key = "sw_file"
      url = "#{api.url}"
      environment = "prod"

      [staging]
      key = "sw_staging"
      url = "#{api.url}"
    TOML
    assert_equal "prod", Skywake.new.whoami["environment"]
    seen = api.seen.last
    assert_equal ["Bearer sw_file", "prod", "/v2/whoami"],
                 [seen.headers["authorization"], seen.headers["skywake-environment"], seen.path]
    ENV["SKYWAKE_PROFILE"] = "staging"
    Skywake.new.whoami
    assert_equal "Bearer sw_staging", api.seen.last.headers["authorization"]
    assert_nil api.seen.last.headers["skywake-environment"]
  end

  def test_code_beats_the_environment_which_beats_the_file
    api = echo
    credentials(%([default]\nkey = "sw_file"\nurl = "http://127.0.0.1:1"\n))
    ENV["SKYWAKE_API_KEY"] = "sw_env"
    ENV["SKYWAKE_URL"] = api.url
    Skywake.new(environment: "staging").whoami
    assert_equal "Bearer sw_env", api.seen.last.headers["authorization"]
    assert_equal "staging", api.seen.last.headers["skywake-environment"]
    Skywake.new(key: "sw_code", url: api.url).whoami
    assert_equal "Bearer sw_code", api.seen.last.headers["authorization"]
  end
end
