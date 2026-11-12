package dev.skywake;

import java.util.Map;

public record Ranked(Object id, double score, Map<String, Object> attributes) {}
