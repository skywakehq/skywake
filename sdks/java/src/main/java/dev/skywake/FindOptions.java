package dev.skywake;

public final class FindOptions extends Options<FindOptions> {
    public FindOptions path(String path) {
        return set("path", path);
    }

    public FindOptions kind(Kind kind) {
        return set("kind", kind);
    }

    public FindOptions limit(int limit) {
        return set("limit", limit);
    }

    public FindOptions at(String at) {
        return set("at", at);
    }
}
