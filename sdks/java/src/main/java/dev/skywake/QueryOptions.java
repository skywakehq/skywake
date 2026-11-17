package dev.skywake;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class QueryOptions extends Options<QueryOptions> {
    private final Map<String, String> sort = new LinkedHashMap<>();

    public QueryOptions vector(double... vector) {
        return set("vector", vector);
    }

    public QueryOptions filter(Map<String, ?> filter) {
        return set("filter", filter);
    }

    public QueryOptions limit(int limit) {
        return set("limit", limit);
    }

    public QueryOptions mode(Mode mode) {
        return set("mode", mode);
    }

    public QueryOptions sort(String field, String direction) {
        sort.put(field, direction);
        return set("sort", sort);
    }

    public QueryOptions fields(String... fields) {
        return set("fields", List.of(fields));
    }
}
