package dev.skywake;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.stream.Collectors;

final class Urls {
    private Urls() {}

    static String segment(Object name) {
        return URLEncoder.encode(String.valueOf(name), StandardCharsets.UTF_8).replace("+", "%20");
    }

    static String filePath(String path) {
        return Arrays.stream(path.replaceFirst("^/+", "").split("/", -1))
                .map(Urls::segment)
                .collect(Collectors.joining("/"));
    }

    static String query(Map<String, ?> query) {
        if (query == null) {
            return "";
        }
        String joined = query.entrySet().stream()
                .filter(entry -> entry.getValue() != null)
                .map(entry -> segment(entry.getKey()) + "=" + segment(entry.getValue()))
                .collect(Collectors.joining("&"));
        return joined.isEmpty() ? "" : "?" + joined;
    }

    static String base(String url) {
        return url.replaceAll("/+$", "").replaceAll("/v[12]$", "");
    }

    static String clean(String path) {
        return path.replaceAll("^/+|/+$", "");
    }

    static String parent(String path) {
        int slash = path.lastIndexOf('/');
        return slash < 0 ? "" : path.substring(0, slash);
    }
}
