require "json"

module Skywake
  module Settings
    DEFAULT_URL = "https://api.skywake.dev".freeze
    FIELDS = %w[key url environment].freeze
    TABLE = /\A\[\s*([^\]]+?)\s*\]\z/.freeze
    PAIR = /\A([A-Za-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"\z/.freeze

    module_function

    def resolve(key: nil, url: nil, environment: nil, profile: nil)
      given = key || env("SKYWAKE_API_KEY") || env("SKYWAKE_KEY")
      stored = given ? {} : read_profile(profile || env("SKYWAKE_PROFILE") || "default")
      key = given || stored["key"]
      raise ArgumentError, "no Skywake API key: run `skywake login`, set SKYWAKE_API_KEY, or pass key:" unless key

      {
        key: key,
        url: url || env("SKYWAKE_URL") || stored["url"] || DEFAULT_URL,
        environment: environment || env("SKYWAKE_ENV") || stored["environment"]
      }
    end

    def env(name)
      value = ENV[name]
      value unless value.nil? || value.empty?
    end

    def credentials_path
      return File.join(env("APPDATA"), "skywake", "credentials.toml") if Gem.win_platform? && env("APPDATA")

      File.join(env("XDG_CONFIG_HOME") || File.join(Dir.home, ".config"), "skywake", "credentials.toml")
    end

    def parse_credentials(text)
      profiles = {}
      current = nil
      text.each_line do |raw|
        line = raw.strip
        next if line.empty? || line.start_with?("#")

        if (table = TABLE.match(line))
          current = profiles[table[1]] ||= {}
        elsif (pair = PAIR.match(line)) && current && FIELDS.include?(pair[1])
          current[pair[1]] = JSON.parse("\"#{pair[2]}\"")
        end
      end
      profiles
    end

    def read_profile(name)
      parse_credentials(File.read(credentials_path)).fetch(name, {})
    rescue SystemCallError, ArgumentError
      {}
    end
  end
end
