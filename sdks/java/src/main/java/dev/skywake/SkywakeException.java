package dev.skywake;

public class SkywakeException extends RuntimeException {
    private final Problem problem;

    SkywakeException(Problem problem) {
        super(problem.hint() == null ? problem.message() : problem.message() + "; " + problem.hint());
        this.problem = problem;
    }

    public int status() {
        return problem.status();
    }

    public String code() {
        return problem.code();
    }

    public String hint() {
        return problem.hint();
    }

    public String requestId() {
        return problem.requestId();
    }

    public String path() {
        return problem.path();
    }
}
