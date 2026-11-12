package dev.skywake;

import java.util.List;
import java.util.Map;

/**
 * Finds the documents that best match words by BM25. {@code fields} are the text attributes to
 * search (every one by default) and {@code boosts} a weight per field. {@code k1} and {@code b}
 * override BM25's parameters. {@code highlight} names text attributes to return the best fragment
 * of. {@code fuzzy} (1 or 2) also matches words that many typos away.
 */
public final class Search {
    private final String query;
    private List<String> fields;
    private Map<String, Double> boosts;
    private Integer topK;
    private Double k1;
    private Double b;
    private Object filter;
    private List<String> include;
    private List<String> exclude;
    private List<String> highlight;
    private Integer fuzzy;
    private Integer offset;
    private Per per;
    private String consistency;
    private Rerank rerank;

    public Search(String query) {
        this.query = query;
    }

    public Search fields(List<String> fields) {
        this.fields = fields;
        return this;
    }

    public Search boosts(Map<String, Double> boosts) {
        this.boosts = boosts;
        return this;
    }

    public Search topK(int topK) {
        this.topK = topK;
        return this;
    }

    public Search k1(double k1) {
        this.k1 = k1;
        return this;
    }

    public Search b(double b) {
        this.b = b;
        return this;
    }

    public Search filter(Object filter) {
        this.filter = filter;
        return this;
    }

    public Search include(List<String> include) {
        this.include = include;
        return this;
    }

    public Search exclude(List<String> exclude) {
        this.exclude = exclude;
        return this;
    }

    public Search highlight(List<String> highlight) {
        this.highlight = highlight;
        return this;
    }

    public Search fuzzy(int fuzzy) {
        this.fuzzy = fuzzy;
        return this;
    }

    public Search offset(int offset) {
        this.offset = offset;
        return this;
    }

    public Search per(Per per) {
        this.per = per;
        return this;
    }

    public Search consistency(String consistency) {
        this.consistency = consistency;
        return this;
    }

    public Search rerank(Rerank rerank) {
        this.rerank = rerank;
        return this;
    }
}
