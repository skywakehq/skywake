package dev.skywake;

public final class MergeOptions extends Options<MergeOptions> {
    public MergeOptions message(String message) {
        return set("message", message);
    }

    public MergeOptions dryRun(boolean dryRun) {
        return set("dry_run", dryRun);
    }

    public MergeOptions prefer(Prefer prefer) {
        return set("prefer", prefer);
    }
}
