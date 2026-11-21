module Skywake
  class Client
    attr_reader :url, :environment

    def initialize(key: nil, url: nil, environment: nil, profile: nil, timeout: 60, retries: 3, backoff: 0.2)
      settings = Settings.resolve(key: key, url: url, environment: environment, profile: profile)
      @url = settings[:url].sub(%r{/+\z}, "").sub(%r{/v[12]\z}, "")
      @environment = settings[:environment]
      transport = Transport.new(timeout: timeout, retries: retries, backoff: backoff)
      @http = Http.new("#{@url}/v2", headers(settings[:key]), transport)
    end

    def disk(name, branch: nil)
      Disk.new(@http, name, branch || MAIN)
    end

    def create_disk(name, region: nil, search: nil, visibility: nil)
      @http.call("POST", "/disks", json: { name: name, region: region, search: search, visibility: visibility }.compact)
      disk(name)
    end

    def list_disks
      @http.pages("/disks")
    end

    def create_key(name, role, environment: nil, only: nil, expires_in_days: nil)
      body = { name: name, role: role, only: only, expires_in_days: expires_in_days }.compact
      @http.call("POST", "/keys", json: body.merge(environment: environment))
    end

    def list_keys
      @http.pages("/keys")
    end

    def revoke_key(id)
      @http.call("DELETE", "/keys/#{Http.segment(id)}")
      nil
    end

    def list_environments
      @http.pages("/environments")
    end

    def create_environment(name)
      @http.call("POST", "/environments", json: { name: name })
    end

    def whoami
      @http.call("GET", "/whoami")
    end

    def inspect
      "#<Skywake::Client #{@url} environment=#{@environment.inspect}>"
    end

    private

    def headers(key)
      headers = { "authorization" => "Bearer #{key}", "user-agent" => "skywake-ruby/#{VERSION}" }
      headers["skywake-environment"] = @environment if @environment
      headers
    end
  end
end
