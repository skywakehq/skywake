package dev.skywake;

/** What a request counted toward the bill. */
public record Billing(int queries, int writes, int deletes, int embeddings, int reranks) {}
