package dev.skywake;

/** Copies a branch to a new index, as its main. */
public final class CopyIndex {
    private final String name;
    private String region;
    private Encryption encryption;

    public CopyIndex(String name) {
        this.name = name;
    }

    String name() {
        return name;
    }

    public CopyIndex region(String region) {
        this.region = region;
        return this;
    }

    public CopyIndex encryption(Encryption encryption) {
        this.encryption = encryption;
        return this;
    }
}
