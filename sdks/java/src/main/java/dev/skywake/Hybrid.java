package dev.skywake;

import java.util.Map;

/**
 * Runs named searches, each a {@link Query} or a {@link Search}, on one snapshot and fuses them by
 * reciprocal rank. {@code rank} scores the hits by an expression instead, such as
 * {"sum": [{"search": "title"}, {"search": "body"}]}.
 */
public final class Hybrid {
    private final Map<String, Object> searches;
    private Integer topK;
    private Fuse fuse = new Fuse(null, null);
    private Integer offset;
    private Per per;
    private String consistency;
    private Object rank;
    private Rerank rerank;

    public Hybrid(Map<String, Object> searches) {
        this.searches = searches;
    }

    public Hybrid topK(int topK) {
        this.topK = topK;
        return this;
    }

    public Hybrid fuse(Fuse fuse) {
        this.fuse = fuse;
        return this;
    }

    public Hybrid offset(int offset) {
        this.offset = offset;
        return this;
    }

    public Hybrid per(Per per) {
        this.per = per;
        return this;
    }

    public Hybrid consistency(String consistency) {
        this.consistency = consistency;
        return this;
    }

    public Hybrid rank(Object rank) {
        this.rank = rank;
        return this;
    }

    public Hybrid rerank(Rerank rerank) {
        this.rerank = rerank;
        return this;
    }
}
