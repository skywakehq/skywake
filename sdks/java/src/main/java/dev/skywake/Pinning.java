package dev.skywake;

import java.util.List;

/** Where an index is pinned: fewer replicas than asked while fewer servers run. */
public record Pinning(List<PinnedReplica> replicas) {}
