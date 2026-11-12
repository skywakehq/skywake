package dev.skywake;

import java.net.http.HttpHeaders;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;

/** When a failed request is tried again, and how long to wait first. */
final class Retry {
    // Sending these again has the same effect as sending them once.
    private static final Set<String> IDEMPOTENT = Set.of("GET", "HEAD", "PUT", "DELETE", "OPTIONS");
    // The server asks for at most 60 seconds; waiting less would only be refused again.
    private static final double MAX_WAIT = 60;

    private final int retries;
    private final Duration backoff;

    Retry(int retries, Duration backoff) {
        this.retries = retries;
        this.backoff = backoff;
    }

    static boolean idempotent(String method) {
        return IDEMPOTENT.contains(method);
    }

    /** A 429 is always worth another try; a 5xx only when sending again is safe. */
    static boolean worthRetrying(int status, boolean idempotent) {
        return status == 429 || (idempotent && status >= 500);
    }

    boolean isLast(int attempt) {
        return attempt >= retries;
    }

    /** Seconds to wait after an answer: as long as the server asks, else the backoff. */
    double after(int attempt, HttpHeaders headers) {
        double asked = retryAfter(headers);
        return Math.min(asked > 0 ? asked : backoff(attempt), MAX_WAIT);
    }

    // Full jitter, so many clients that failed together do not retry together.
    double backoff(int attempt) {
        double ceiling = Math.min(MAX_WAIT, backoff.toNanos() / 1e9 * Math.pow(2, attempt));
        return ThreadLocalRandom.current().nextDouble() * ceiling;
    }

    private static double retryAfter(HttpHeaders headers) {
        try {
            double seconds = Double.parseDouble(headers.firstValue("retry-after").orElse(""));
            return seconds > 0 ? seconds : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
