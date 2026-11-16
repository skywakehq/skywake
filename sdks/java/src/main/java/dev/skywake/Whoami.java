package dev.skywake;

import java.util.List;

public record Whoami(
        String organization,
        String environment,
        Role role,
        List<String> only,
        String key,
        String user,
        String email,
        String expires) {}
