package dev.skywake;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.http.HttpHeaders;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

final class Errors {
    private Errors() {}

    static SkywakeException of(int status, HttpHeaders headers, byte[] body) {
        JsonNode error = errorOf(body);
        Problem problem = new Problem(
                status,
                text(error, "code"),
                textOr(error, "message", "HTTP " + status),
                text(error, "hint"),
                textOr(error, "request_id", headers.firstValue("x-request-id").orElse(null)),
                text(error, "path"));
        List<String> conflicts = conflicts(error);
        if (status == 401) {
            return new AuthException(problem);
        }
        if (status == 403) {
            return new PermissionException(problem);
        }
        if (status == 404) {
            return new NotFoundException(problem);
        }
        if (status == 409 && !conflicts.isEmpty()) {
            return new MergeConflictException(problem, conflicts);
        }
        if (status == 409) {
            return new ConflictException(problem);
        }
        if (status == 429) {
            return new RateLimitedException(problem, retryAfter(headers));
        }
        if (status >= 500) {
            return new ServerException(problem);
        }
        return new InvalidRequestException(problem);
    }

    static Duration retryAfter(HttpHeaders headers) {
        try {
            double seconds = Double.parseDouble(headers.firstValue("retry-after").orElse(""));
            return seconds > 0 ? Duration.ofMillis((long) (seconds * 1000)) : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static JsonNode errorOf(byte[] body) {
        JsonNode parsed;
        try {
            parsed = Json.tree(body);
        } catch (RuntimeException e) {
            return Json.MAPPER.createObjectNode();
        }
        JsonNode error = parsed.path("error");
        if (error.isObject()) {
            return error;
        }
        return Json.MAPPER.createObjectNode()
                .put("message", error.isTextual() ? error.asText() : null)
                .put("code", parsed.path("code").isTextual() ? parsed.path("code").asText() : null);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isTextual() ? value.asText() : null;
    }

    private static String textOr(JsonNode node, String field, String fallback) {
        String value = text(node, field);
        return value == null ? fallback : value;
    }

    private static List<String> conflicts(JsonNode error) {
        List<String> found = new ArrayList<>();
        error.path("conflicts").forEach(item -> found.add(item.asText()));
        return found;
    }
}
