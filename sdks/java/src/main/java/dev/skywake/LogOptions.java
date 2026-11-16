package dev.skywake;

public final class LogOptions extends Options<LogOptions> {
    public LogOptions path(String path) {
        return set("path", path);
    }

    public LogOptions limit(int limit) {
        return set("limit", limit);
    }
}
