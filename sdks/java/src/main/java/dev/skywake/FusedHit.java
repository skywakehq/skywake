package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

public record FusedHit(
        Object id,
        double score,
        Map<String, Integer> ranks,
        Map<String, Double> scores,
        Map<String, Object> attributes,
        Map<String, Highlight> highlights,
        @JsonProperty("rerank_score") Double rerankScore) {}
