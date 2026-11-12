package dev.skywake;

/** Servers reserved for an index, billed per GB-hour for each replica instead of per query. */
public record Pinned(int replicas) {}
