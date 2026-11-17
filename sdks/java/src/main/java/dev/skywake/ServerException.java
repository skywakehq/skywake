package dev.skywake;

public class ServerException extends SkywakeException {
    ServerException(Problem problem) {
        super(problem);
    }
}
