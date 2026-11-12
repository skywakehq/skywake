package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

public record SearchHit(
        Object id,
        double score,
        Map<String, Object> attributes,
        Map<String, Highlight> highlights,
        @JsonProperty("rerank_score") Double rerankScore) {}
