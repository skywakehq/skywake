package dev.skywake;

public final class FileQueryOptions extends Options<FileQueryOptions> {
    public FileQueryOptions limit(int limit) {
        return set("limit", limit);
    }

    public FileQueryOptions path(String path) {
        return set("path", path);
    }
}
