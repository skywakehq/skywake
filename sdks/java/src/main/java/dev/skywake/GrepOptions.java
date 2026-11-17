package dev.skywake;

public final class GrepOptions extends Options<GrepOptions> {
    public GrepOptions path(String path) {
        return set("path", path);
    }

    public GrepOptions glob(String glob) {
        return set("glob", glob);
    }

    public GrepOptions ignoreCase(boolean ignoreCase) {
        return set("ignore_case", ignoreCase);
    }

    public GrepOptions limit(int limit) {
        return set("limit", limit);
    }

    public GrepOptions at(String at) {
        return set("at", at);
    }
}
