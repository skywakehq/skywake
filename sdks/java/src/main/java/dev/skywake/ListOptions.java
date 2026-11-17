package dev.skywake;

public final class ListOptions extends Options<ListOptions> {
    public ListOptions recursive(boolean recursive) {
        return set("recursive", recursive);
    }

    public ListOptions at(String at) {
        return set("at", at);
    }
}
