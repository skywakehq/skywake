package dev.skywake;

public final class DiskSettings extends Options<DiskSettings> {
    public DiskSettings search(boolean search) {
        return set("search", search);
    }

    public DiskSettings visibility(Visibility visibility) {
        return set("visibility", visibility);
    }
}
