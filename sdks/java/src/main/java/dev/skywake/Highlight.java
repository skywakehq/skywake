package dev.skywake;

import java.util.List;

/** The best fragment of a text attribute, with each matched word as [start, end) in UTF-16 code units. */
public record Highlight(String text, List<int[]> marks) {}
