package dev.skywake;

public record Entry(
        String path,
        String kind,
        long size,
        String modified,
        boolean executable,
        String target) {}
