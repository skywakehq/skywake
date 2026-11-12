package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;

/** A branch's counts. */
public record Stats(
        long rows,
        @JsonProperty("deleted_rows") long deletedRows,
        long segments,
        @JsonProperty("indexed_rows") long indexedRows,
        @JsonProperty("unindexed_rows") long unindexedRows,
        long clusters,
        long bytes) {}
