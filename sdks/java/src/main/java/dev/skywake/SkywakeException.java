package dev.skywake;

/**
 * An error answer from the API. {@link #code()} says what kind of error it is, such as
 * "not_found" or "rate_limited". Quote {@link #requestId()} when you report a bug. For an
 * invalid request, {@link #path()} is the JSON path of the field that is wrong.
 */
public final class SkywakeException extends RuntimeException {
    private final int status;
    private final String message;
    private final String code;
    private final String requestId;
    private final String path;

    public SkywakeException(int status, String message, String code, String requestId, String path) {
        super(status + ": " + message);
        this.status = status;
        this.message = message;
        this.code = code;
        this.requestId = requestId;
        this.path = path;
    }

    public int status() {
        return status;
    }

    /** The API's message, without the status. */
    public String message() {
        return message;
    }

    public String code() {
        return code;
    }

    public String requestId() {
        return requestId;
    }

    public String path() {
        return path;
    }
}
