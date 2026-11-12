package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * An index's settings. {@code pinned} is null when it is not pinned. {@code stats}, of main, and {@code pinning} are
 * only read by get; {@code stats} is null while the server cannot count them.
 */
public record Index(
        String name,
        String region,
        Schema schema,
        int shards,
        Encryption encryption,
        @JsonProperty("read_only") boolean readOnly,
        // Null when every version is kept.
        @JsonProperty("retention_days") Integer retentionDays,
        Pinned pinned,
        String created,
        Stats stats,
        Pinning pinning) {}
