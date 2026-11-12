package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;

/** Names a key in your cloud's key service that encrypts the index. */
public record Encryption(@JsonProperty("kms_key_id") String kmsKeyId) {}
