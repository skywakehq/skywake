package dev.skywake;

import java.util.List;
import java.util.Map;

public final class IndexSettings extends Options<IndexSettings> {
    public IndexSettings readOnly(boolean readOnly) {
        return set("read_only", readOnly);
    }

    public IndexSettings retentionDays(Integer days) {
        return set("retention_days", days);
    }

    public IndexSettings pinned(Integer replicas) {
        return set("pinned", replicas == null ? null : Map.of("replicas", replicas));
    }

    public IndexSettings attributes(List<Map<String, Object>> attributes) {
        return set("attributes", attributes);
    }

    public IndexSettings dropAttributes(String... names) {
        return set("drop_attributes", List.of(names));
    }
}
