package dev.skywake;

import java.util.Map;

/**
 * A document as written and read. Its id is a string, or a whole number from 0. A vector may be
 * text, or {"image": url}, when its column embeds.
 */
public record Document(Object id, Map<String, Object> vectors, Map<String, Object> attributes) {}
