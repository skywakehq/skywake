package dev.skywake;

public final class ReadOptions extends Options<ReadOptions> {
    public ReadOptions at(String at) {
        return set("at", at);
    }

    public ReadOptions offset(long offset) {
        return set("offset", offset);
    }

    public ReadOptions length(long length) {
        return set("length", length);
    }
}
