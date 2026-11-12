package dev.skywake;

/** What a query searches near: numbers, or text or {"image": url} when the column embeds. */
public record Vector(String column, Object value) {}
