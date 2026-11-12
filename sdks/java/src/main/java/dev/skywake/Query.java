package dev.skywake;

import java.util.List;

/**
 * Finds the topK nearest documents to a vector that pass a filter, such as
 * {"and": [{"tag": {"eq": "billing"}}, {"price": {"lt": 10}}]}. {@code recall} is the share of the
 * true nearest to find (0.95 by default, 1 is exact); {@code probe} overrides it with a number of
 * clusters. Consistency "eventual" may read what the server saw up to a minute ago, which is faster.
 */
public final class Query {
    private final Vector vector;
    private Integer topK;
    private Double recall;
    private Integer probe;
    private Object filter;
    private List<String> include;
    private List<String> exclude;
    private Integer offset;
    private Per per;
    private String consistency;
    private Rerank rerank;

    /** {@code value} is numbers, such as a float[], or text or {"image": url} when the column embeds. */
    public Query(String column, Object value) {
        this.vector = new Vector(column, value);
    }

    public Query topK(int topK) {
        this.topK = topK;
        return this;
    }

    public Query recall(double recall) {
        this.recall = recall;
        return this;
    }

    public Query probe(int probe) {
        this.probe = probe;
        return this;
    }

    public Query filter(Object filter) {
        this.filter = filter;
        return this;
    }

    public Query include(List<String> include) {
        this.include = include;
        return this;
    }

    public Query exclude(List<String> exclude) {
        this.exclude = exclude;
        return this;
    }

    public Query offset(int offset) {
        this.offset = offset;
        return this;
    }

    public Query per(Per per) {
        this.per = per;
        return this;
    }

    public Query consistency(String consistency) {
        this.consistency = consistency;
        return this;
    }

    public Query rerank(Rerank rerank) {
        this.rerank = rerank;
        return this;
    }
}
