package dev.skywake;

public class ConflictException extends SkywakeException {
    ConflictException(Problem problem) {
        super(problem);
    }
}
