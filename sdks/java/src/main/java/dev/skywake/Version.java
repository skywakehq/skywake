package dev.skywake;

/** A branch at one moment of its history. */
public record Version(String version, String time, long rows) {}
