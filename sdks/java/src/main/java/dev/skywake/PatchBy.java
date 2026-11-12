package dev.skywake;

import java.util.Map;

/** Sets attributes of every document that passes {@code filter}. */
public record PatchBy(Object filter, Map<String, Object> attributes) {}
