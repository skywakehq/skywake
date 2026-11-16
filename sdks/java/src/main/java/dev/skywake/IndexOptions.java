package dev.skywake;

import java.util.Map;

public final class IndexOptions extends Options<IndexOptions> {
    public IndexOptions schema(Map<String, ?> schema) {
        return set("schema", schema);
    }

    public IndexOptions region(String region) {
        return set("region", region);
    }

    public IndexOptions embed(String model) {
        return set("embed", Map.of("model", model));
    }

    public IndexOptions noEmbed() {
        return set("embed", false);
    }
}
