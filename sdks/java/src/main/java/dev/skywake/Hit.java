package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

public record Hit(
        Object id, double distance, Map<String, Object> attributes, @JsonProperty("rerank_score") Double rerankScore) {}
