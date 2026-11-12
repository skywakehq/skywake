package dev.skywake;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;

/** A client of the Skywake API. It is safe to share between threads. */
public final class Skywake {
    // The tests read and write bodies with the SDK's own mapping.
    static final ObjectMapper JSON = Json.MAPPER;

    private final Transport transport;
    private final Indexes indexes;

    /** A client of the API at {@code url}, with an API key (sw_...) or a console token. */
    public Skywake(String url, String key) {
        this(url, key, Duration.ofSeconds(60), 3, Duration.ofMillis(200));
    }

    /**
     * {@code timeout} is how long one try may wait to connect, and then for the answer to start;
     * an answer that keeps arriving, such as an export, is never cut off. A failed request is
     * tried up to {@code retries} more times when that is safe: after a 429 always, and after a
     * network error or a 5xx for GET, PUT and DELETE. It waits about {@code backoff}, doubled
     * each time, or as long as the server asks (at most 60 seconds).
     */
    public Skywake(String url, String key, Duration timeout, int retries, Duration backoff) {
        this.transport = new Transport(url, key, timeout, new Retry(retries, backoff));
        this.indexes = new Indexes(transport);
    }

    /** Makes, lists, reads and deletes search indexes. */
    public Indexes indexes() {
        return indexes;
    }

    /** A search index, on its main branch. */
    public SearchIndex index(String name) {
        return SearchIndex.main(transport, name);
    }
}
