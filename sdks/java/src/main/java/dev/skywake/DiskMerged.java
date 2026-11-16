package dev.skywake;

import java.util.List;

public record DiskMerged(String commit, List<String> conflicts) {}
