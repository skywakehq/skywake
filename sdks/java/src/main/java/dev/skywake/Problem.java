package dev.skywake;

record Problem(int status, String code, String message, String hint, String requestId, String path) {}
