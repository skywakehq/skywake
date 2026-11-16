package dev.skywake;

public class NotFoundException extends SkywakeException {
    NotFoundException(Problem problem) {
        super(problem);
    }
}
