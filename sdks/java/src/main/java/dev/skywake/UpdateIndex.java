package dev.skywake;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** Adds attributes, makes the index read-only or writable again, or pins it, on every branch. */
public final class UpdateIndex {
    private List<Attribute> attributes;

    @JsonProperty("read_only")
    private Boolean readOnly;

    @JsonProperty("retention_days")
    private Integer retentionDays;

    @JsonIgnore
    private boolean keepAllVersions;

    private Pinned pinned;

    @JsonIgnore
    private boolean unpin;

    public UpdateIndex attributes(List<Attribute> attributes) {
        this.attributes = attributes;
        return this;
    }

    public UpdateIndex readOnly(boolean readOnly) {
        this.readOnly = readOnly;
        return this;
    }

    /** How long older versions stay after they were replaced. */
    public UpdateIndex retentionDays(int days) {
        this.retentionDays = days;
        return this;
    }

    /** Keeps every older version, instead of for some days. */
    public UpdateIndex keepAllVersions() {
        this.keepAllVersions = true;
        return this;
    }

    /** Pins the index to {@code replicas} servers. */
    public UpdateIndex pinned(int replicas) {
        this.pinned = new Pinned(replicas);
        return this;
    }

    /** Unpins the index. */
    public UpdateIndex unpin() {
        this.unpin = true;
        return this;
    }

    boolean keepsAllVersions() {
        return keepAllVersions;
    }

    boolean unpins() {
        return unpin;
    }
}
