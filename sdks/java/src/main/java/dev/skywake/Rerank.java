package dev.skywake;

/** Orders hits again with a rerank model, by {@code query} or by the request's own text. */
public record Rerank(String model, String field, String query, Integer topN) {
    public Rerank(String model, String field) {
        this(model, field, null, null);
    }
}
