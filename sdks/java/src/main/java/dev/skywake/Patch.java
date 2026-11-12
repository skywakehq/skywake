package dev.skywake;

import java.util.Map;

/** Sets attributes of a document; a null value removes one. */
public record Patch(Object id, Map<String, Object> attributes) {}
