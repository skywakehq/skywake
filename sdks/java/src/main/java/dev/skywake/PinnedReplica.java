package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;

/** A server holding a pinned index; {@code warm} once every object of the current version is on its disk. */
public record PinnedReplica(String server, boolean warm, @JsonProperty("in_flight") int inFlight) {}
