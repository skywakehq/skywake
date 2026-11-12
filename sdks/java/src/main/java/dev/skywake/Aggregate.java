package dev.skywake;

import java.util.List;
import java.util.Map;

/**
 * Measures the documents that pass the filter, in one group or one per set of groupBy values. Each
 * measure is named, such as {"total": ["count"], "revenue": ["sum", "price"]}; the others are
 * "avg", "min" and "max".
 */
public final class Aggregate {
    private final Map<String, List<String>> measures;
    private List<String> groupBy;
    private Object filter;
    private String consistency;

    public Aggregate(Map<String, List<String>> measures) {
        this.measures = measures;
    }

    public Aggregate groupBy(List<String> groupBy) {
        this.groupBy = groupBy;
        return this;
    }

    public Aggregate filter(Object filter) {
        this.filter = filter;
        return this;
    }

    public Aggregate consistency(String consistency) {
        this.consistency = consistency;
        return this;
    }
}
