package dev.skywake;

import java.util.List;

/**
 * Upserts, patches and deletes as one change, in this order: deleteBy, patchBy, upserts, patches,
 * deletes. A condition is a filter checked against each document as it was, whose values may be
 * {"$ref_new": attribute}, such as {"version": {"lt": {"$ref_new": "version"}}}.
 */
public final class Write {
    private List<Document> upserts;
    private List<Patch> patches;
    private List<?> deletes;
    private Object upsertIf;
    private Object patchIf;
    private Object deleteIf;
    private Object deleteBy;
    private PatchBy patchBy;
    private Boolean returnAffectedIds;

    public Write upserts(List<Document> upserts) {
        this.upserts = upserts;
        return this;
    }

    public Write patches(List<Patch> patches) {
        this.patches = patches;
        return this;
    }

    public Write deletes(List<?> deletes) {
        this.deletes = deletes;
        return this;
    }

    public Write upsertIf(Object condition) {
        this.upsertIf = condition;
        return this;
    }

    public Write patchIf(Object condition) {
        this.patchIf = condition;
        return this;
    }

    public Write deleteIf(Object condition) {
        this.deleteIf = condition;
        return this;
    }

    public Write deleteBy(Object filter) {
        this.deleteBy = filter;
        return this;
    }

    public Write patchBy(PatchBy patchBy) {
        this.patchBy = patchBy;
        return this;
    }

    /** Also returns the ids behind the counts. */
    public Write returnAffectedIds() {
        this.returnAffectedIds = true;
        return this;
    }
}
