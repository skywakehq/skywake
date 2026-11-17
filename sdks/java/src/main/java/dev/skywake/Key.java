package dev.skywake;

import java.util.List;

public record Key(
        String id,
        String name,
        Role role,
        String environment,
        List<String> only,
        String expires,
        String lastUsed,
        String created,
        String createdBy) {}
