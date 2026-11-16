package dev.skywake;

import java.util.List;

public record DiskInfo(
        String name,
        String region,
        Visibility visibility,
        String created,
        boolean search,
        List<String> branches) {}
