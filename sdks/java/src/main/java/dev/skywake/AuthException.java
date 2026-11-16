package dev.skywake;

public class AuthException extends SkywakeException {
    AuthException(Problem problem) {
        super(problem);
    }
}
