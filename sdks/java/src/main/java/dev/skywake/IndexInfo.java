package dev.skywake;

import java.util.List;
import java.util.Map;

public record IndexInfo(
        String name,
        String region,
        String created,
        Map<String, Object> schema,
        Long rows,
        Long bytes,
        boolean readOnly,
        Integer retentionDays,
        List<String> branches) {}
