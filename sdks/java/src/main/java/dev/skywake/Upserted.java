package dev.skywake;

import java.util.List;

public record Upserted(List<Object> ids, long count) {}
