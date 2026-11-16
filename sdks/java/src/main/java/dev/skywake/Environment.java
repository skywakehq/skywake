package dev.skywake;

import java.util.Map;

public record Environment(String name, String created, Map<String, Object> store) {}
