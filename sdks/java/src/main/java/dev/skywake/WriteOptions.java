package dev.skywake;

public final class WriteOptions extends Options<WriteOptions> {
    public WriteOptions message(String message) {
        return set("message", message);
    }

    public WriteOptions executable(boolean executable) {
        return set("executable", executable);
    }

    String message() {
        return (String) body().get("message");
    }

    Boolean executable() {
        return (Boolean) body().get("executable");
    }
}
