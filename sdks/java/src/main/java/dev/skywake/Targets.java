package dev.skywake;

import java.util.Collection;
import java.util.Map;

final class Targets {
    private Targets() {}

    static Body of(Object target) {
        if (target instanceof String || target instanceof Number) {
            return new Body().with("id", target);
        }
        if (target instanceof Collection<?> ids) {
            return new Body().with("ids", ids);
        }
        if (target instanceof Map<?, ?> filter) {
            boolean wrapped = filter.size() == 1 && filter.containsKey("filter");
            return new Body().with("filter", wrapped ? filter.get("filter") : filter);
        }
        throw new IllegalArgumentException("a target is an id, a list of ids, or a filter");
    }
}
