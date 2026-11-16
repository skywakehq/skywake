package dev.skywake;

import java.util.List;
import java.util.Map;

public final class Aggregation extends Options<Aggregation> {
    public Aggregation groupBy(String... fields) {
        return set("group_by", List.of(fields));
    }

    public Aggregation count(boolean count) {
        return set("count", count);
    }

    public Aggregation sum(String... fields) {
        return set("sum", List.of(fields));
    }

    public Aggregation avg(String... fields) {
        return set("avg", List.of(fields));
    }

    public Aggregation min(String... fields) {
        return set("min", List.of(fields));
    }

    public Aggregation max(String... fields) {
        return set("max", List.of(fields));
    }

    public Aggregation filter(Map<String, ?> filter) {
        return set("filter", filter);
    }
}
