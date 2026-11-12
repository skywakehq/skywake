package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;

/** How long a read took and where its reads came from. */
public record Performance(
        @JsonProperty("server_ms") int serverMs,
        @JsonProperty("cache_temperature") String cacheTemperature,
        @JsonProperty("cache_hit_ratio") double cacheHitRatio) {}
