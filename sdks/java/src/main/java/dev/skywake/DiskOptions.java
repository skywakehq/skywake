package dev.skywake;

public final class DiskOptions extends Options<DiskOptions> {
    public DiskOptions region(String region) {
        return set("region", region);
    }

    public DiskOptions search(boolean search) {
        return set("search", search);
    }

    public DiskOptions visibility(Visibility visibility) {
        return set("visibility", visibility);
    }
}
