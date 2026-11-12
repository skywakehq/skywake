package dev.skywake;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.stream.Collectors;

/** Builds the API's URLs. */
final class Urls {
    private Urls() {}

    /** The base of every route: {@code url} with /v1, whether or not it ended with it. */
    static String base(String url) {
        String trimmed = url.replaceAll("/+$", "");
        return (trimmed.endsWith("/v1") ? trimmed.substring(0, trimmed.length() - 3) : trimmed) + "/v1";
    }

    /** Keeps a name whole in a URL: index and branch names may hold /. */
    static String escape(String name) {
        return URLEncoder.encode(name, StandardCharsets.UTF_8).replace("+", "%20");
    }

    static String query(Map<String, ?> query) {
        if (query == null || query.isEmpty()) {
            return "";
        }
        return "?" + query.entrySet().stream()
                .map(e -> escape(e.getKey()) + "=" + escape(String.valueOf(e.getValue())))
                .collect(Collectors.joining("&"));
    }
}
