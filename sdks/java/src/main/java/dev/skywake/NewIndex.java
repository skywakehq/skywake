package dev.skywake;

/** Makes an index. {@code shards} splits the documents (1 by default). */
public final class NewIndex {
    private final String name;
    private final Schema schema;
    private String region;
    private Integer shards;
    private Encryption encryption;
    private Pinned pinned;

    public NewIndex(String name, Schema schema) {
        this.name = name;
        this.schema = schema;
    }

    String name() {
        return name;
    }

    public NewIndex region(String region) {
        this.region = region;
        return this;
    }

    public NewIndex shards(int shards) {
        this.shards = shards;
        return this;
    }

    public NewIndex encryption(Encryption encryption) {
        this.encryption = encryption;
        return this;
    }

    /** Pins the index to {@code replicas} servers. */
    public NewIndex pinned(int replicas) {
        this.pinned = new Pinned(replicas);
        return this;
    }
}
