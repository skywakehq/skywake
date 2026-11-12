package dev.skywake;

/** A build, warming or collection, and how it went (a collection has no branch): status is "running", "succeeded" or "failed". */
public record Operation(
        String id, String index, String branch, String kind, String status, String error, String started, String finished) {}
