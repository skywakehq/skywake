package dev.skywake;

import java.net.http.HttpHeaders;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;

record Retry(int retries, Duration backoff) {
    private static final Set<String> IDEMPOTENT = Set.of("GET", "HEAD", "PUT", "DELETE", "OPTIONS");
    private static final long MAX_WAIT_MS = 60_000;

    static boolean idempotent(String method) {
        return IDEMPOTENT.contains(method);
    }

    static boolean again(int status, boolean idempotent) {
        return status == 429 || (idempotent && status >= 500);
    }

    boolean last(int attempt) {
        return attempt >= retries;
    }

    long backoffMs(int attempt) {
        double cap = Math.min(MAX_WAIT_MS, backoff.toMillis() * Math.pow(2, attempt));
        return (long) (ThreadLocalRandom.current().nextDouble() * cap);
    }

    long waitMs(int attempt, HttpHeaders headers) {
        Duration after = Errors.retryAfter(headers);
        return Math.min(after == null ? backoffMs(attempt) : after.toMillis(), MAX_WAIT_MS);
    }
}
