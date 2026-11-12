package dev.skywake;

import java.util.List;

/** Keeps at most {@code limit} hits for each set of values of {@code attributes}. */
public record Per(List<String> attributes, int limit) {}
