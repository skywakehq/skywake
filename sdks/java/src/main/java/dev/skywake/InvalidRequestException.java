package dev.skywake;

public class InvalidRequestException extends SkywakeException {
    InvalidRequestException(Problem problem) {
        super(problem);
    }
}
