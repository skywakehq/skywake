package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;

public record Branch(String name, @JsonProperty("forked_from") String forkedFrom, String created) {}
