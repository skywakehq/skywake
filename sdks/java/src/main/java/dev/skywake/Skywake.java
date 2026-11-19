package dev.skywake;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;

public final class Skywake {
    static final String MAIN = "main";

    private final String url;
    private final String environment;
    private final Http http;

    public Skywake() {
        this(builder());
    }

    private Skywake(Builder builder) {
        Settings settings = Settings.resolve(
                new Settings(builder.key, builder.url, builder.environment), builder.profile, builder.env);
        this.url = Urls.base(settings.url());
        this.environment = settings.environment();
        Map<String, String> headers = new HashMap<>();
        headers.put("authorization", "Bearer " + settings.key());
        if (environment != null) {
            headers.put("skywake-environment", environment);
        }
        Retry retry = new Retry(builder.retries, builder.backoff);
        this.http = new Http(url + "/v2", headers, retry, builder.timeout);
    }

    public static Builder builder() {
        return new Builder();
    }

    public String url() {
        return url;
    }

    public String environment() {
        return environment;
    }

    public Index index(String name) {
        return index(name, MAIN);
    }

    public Index index(String name, String branch) {
        return new Index(http, name, branch);
    }

    public Index createIndex(String name) {
        return createIndex(name, new IndexOptions());
    }

    public Index createIndex(String name, IndexOptions options) {
        http.post("/indexes", new Body().with("name", name).with(options.body()));
        return index(name);
    }

    public Iterable<IndexSummary> listIndexes() {
        return list("/indexes", IndexSummary.class);
    }

    public CreatedKey createKey(NewKey key) {
        return Json.as(http.post("/keys", key.body()), CreatedKey.class);
    }

    public Iterable<Key> listKeys() {
        return list("/keys", Key.class);
    }

    public void revokeKey(String id) {
        http.delete("/keys/" + Urls.segment(id));
    }

    public Iterable<Environment> listEnvironments() {
        return list("/environments", Environment.class);
    }

    public Environment createEnvironment(String name) {
        return Json.as(http.post("/environments", new Body().with("name", name)), Environment.class);
    }

    public Whoami whoami() {
        return Json.as(http.get("/whoami", null), Whoami.class);
    }

    private <T> Iterable<T> list(String path, Class<T> type) {
        return Pages.of(http, path, new Body(), type);
    }

    public static final class Builder {
        private String key;
        private String url;
        private String environment;
        private String profile;
        private int retries = 3;
        private Duration timeout = Duration.ofSeconds(60);
        private Duration backoff = Duration.ofMillis(200);
        private Function<String, String> env = System::getenv;

        private Builder() {}

        public Builder key(String key) {
            this.key = key;
            return this;
        }

        public Builder url(String url) {
            this.url = url;
            return this;
        }

        public Builder environment(String environment) {
            this.environment = environment;
            return this;
        }

        public Builder profile(String profile) {
            this.profile = profile;
            return this;
        }

        public Builder retries(int retries) {
            this.retries = retries;
            return this;
        }

        public Builder timeout(Duration timeout) {
            this.timeout = timeout;
            return this;
        }

        public Builder backoff(Duration backoff) {
            this.backoff = backoff;
            return this;
        }

        Builder env(Function<String, String> env) {
            this.env = env;
            return this;
        }

        public Skywake build() {
            return new Skywake(this);
        }
    }
}
