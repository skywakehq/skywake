package dev.skywake;

import java.util.List;

/**
 * Scores every document that passes the filter exactly, such as by
 * {"dot": {"attribute", "indices", "values"}} for sparse vectors or
 * {"max_sim": {"attribute", "vectors"}} for late interaction.
 */
public final class Rank {
    private final Object score;
    private Integer topK;
    private Integer offset;
    private Object filter;
    private List<String> include;
    private List<String> exclude;
    private String consistency;

    public Rank(Object score) {
        this.score = score;
    }

    public Rank topK(int topK) {
        this.topK = topK;
        return this;
    }

    public Rank offset(int offset) {
        this.offset = offset;
        return this;
    }

    public Rank filter(Object filter) {
        this.filter = filter;
        return this;
    }

    public Rank include(List<String> include) {
        this.include = include;
        return this;
    }

    public Rank exclude(List<String> exclude) {
        this.exclude = exclude;
        return this;
    }

    public Rank consistency(String consistency) {
        this.consistency = consistency;
        return this;
    }
}
