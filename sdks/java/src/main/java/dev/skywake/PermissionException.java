package dev.skywake;

public class PermissionException extends SkywakeException {
    PermissionException(Problem problem) {
        super(problem);
    }
}
