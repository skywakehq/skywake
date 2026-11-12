package dev.skywake;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpHeaders;
import java.nio.charset.StandardCharsets;

/** An answer whose body is still to be read. */
record Answer(int status, HttpHeaders headers, InputStream body) {
    boolean ok() {
        return status >= 200 && status < 300;
    }

    /** Throws the answer's error, if it is one. */
    void check() throws IOException {
        if (ok()) {
            return;
        }
        String text = new String(body.readAllBytes(), StandardCharsets.UTF_8);
        String message = text;
        JsonNode error = null;
        try {
            JsonNode parsed = Json.MAPPER.readTree(text);
            if (parsed != null && parsed.path("error").isTextual()) {
                error = parsed;
                message = parsed.get("error").asText();
            }
        } catch (IOException notJson) {
            // The message stays the text of the answer.
        }
        String requestId = text(error, "request_id");
        if (requestId == null) {
            requestId = headers.firstValue("x-request-id").orElse(null);
        }
        throw new SkywakeException(status, message, text(error, "code"), requestId, text(error, "path"));
    }

    void close() {
        close(body);
    }

    static void close(InputStream in) {
        try {
            in.close();
        } catch (IOException ignored) {
            // Nothing more is read from it.
        }
    }

    private static String text(JsonNode body, String field) {
        return body != null && body.path(field).isTextual() ? body.get(field).asText() : null;
    }
}
