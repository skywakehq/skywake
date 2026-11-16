package dev.skywake;

import java.time.Duration;

public class RateLimitedException extends SkywakeException {
    private final Duration retryAfter;

    RateLimitedException(Problem problem, Duration retryAfter) {
        super(problem);
        this.retryAfter = retryAfter;
    }

    public Duration retryAfter() {
        return retryAfter;
    }
}
