package dev.skywake;

import java.util.List;

public class MergeConflictException extends ConflictException {
    private final List<String> conflicts;

    MergeConflictException(Problem problem, List<String> conflicts) {
        super(problem);
        this.conflicts = List.copyOf(conflicts);
    }

    public List<String> conflicts() {
        return conflicts;
    }
}
