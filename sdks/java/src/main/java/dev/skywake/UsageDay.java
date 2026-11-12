package dev.skywake;

/** One day of an index's use. `rows` and `bytes` are null on a day with no snapshot of its size. */
public record UsageDay(
        String day, long queries, long writes, long deletes, long embeddings, long reranks, Long rows, Long bytes) {}
