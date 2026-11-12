package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** What a write did. The ids are there when the write asked for them with returnAffectedIds. */
public record WriteCounts(
        int upserted,
        int patched,
        int deleted,
        @JsonProperty("upserted_ids") List<Object> upsertedIds,
        @JsonProperty("patched_ids") List<Object> patchedIds,
        @JsonProperty("deleted_ids") List<Object> deletedIds,
        Billing billing) {}
