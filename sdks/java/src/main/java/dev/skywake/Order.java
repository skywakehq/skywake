package dev.skywake;

import java.util.List;

/** Lists documents in the order of an attribute, or of "id"; those without it come last. */
public final class Order {
    private final String by;
    private Boolean descending;
    private Integer topK;
    private Integer offset;
    private Object filter;
    private List<String> include;
    private List<String> exclude;
    private String consistency;

    public Order(String by) {
        this.by = by;
    }

    public Order descending() {
        this.descending = true;
        return this;
    }

    public Order topK(int topK) {
        this.topK = topK;
        return this;
    }

    public Order offset(int offset) {
        this.offset = offset;
        return this;
    }

    public Order filter(Object filter) {
        this.filter = filter;
        return this;
    }

    public Order include(List<String> include) {
        this.include = include;
        return this;
    }

    public Order exclude(List<String> exclude) {
        this.exclude = exclude;
        return this;
    }

    public Order consistency(String consistency) {
        this.consistency = consistency;
        return this;
    }
}
