package dev.skywake;

import java.util.Map;

/** Reciprocal rank fusion: a hit scores the sum of weight / (k + rank); k is 60 and weights 1 by default. */
public record Fuse(Integer k, Map<String, Double> weights) {}
