package dev.skywake;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;

final class FakeApi implements AutoCloseable {
    record Seen(String method, String path, Map<String, String> query, Headers headers, byte[] body) {
        JsonNode json() {
            return Json.tree(body);
        }
    }

    record Reply(int status, Object body, Map<String, String> headers, byte[] raw) {
        static Reply json(Object body) {
            return new Reply(200, body, Map.of(), null);
        }

        static Reply status(int status, Object body) {
            return new Reply(status, body, Map.of(), null);
        }

        static Reply raw(byte[] raw) {
            return new Reply(200, null, Map.of(), raw);
        }

        static Reply failure(int status, String code, Map<String, Object> extra) {
            Map<String, Object> error = new HashMap<>();
            error.put("code", code);
            error.put("message", "nope");
            error.put("hint", null);
            error.put("request_id", "req-1");
            error.putAll(extra);
            return status(status, Map.of("error", error));
        }

        static Reply failure(int status, String code) {
            return failure(status, code, Map.of());
        }

        Reply withHeader(String name, String value) {
            return new Reply(status, body, Map.of(name, value), raw);
        }
    }

    final List<Seen> seen = Collections.synchronizedList(new ArrayList<>());
    private final HttpServer server;

    FakeApi(BiFunction<Seen, Integer, Reply> handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try (exchange) {
                Seen one = new Seen(
                        exchange.getRequestMethod(),
                        exchange.getRequestURI().getRawPath(),
                        query(exchange.getRequestURI().getRawQuery()),
                        exchange.getRequestHeaders(),
                        exchange.getRequestBody().readAllBytes());
                seen.add(one);
                send(exchange, handler.apply(one, seen.size()));
            }
        });
        server.start();
    }

    String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    Skywake.Builder builder() {
        return Skywake.builder().url(url()).key("k").backoff(Duration.ofMillis(1)).env(name -> null);
    }

    Skywake sky() {
        return builder().build();
    }

    Seen at(int index) {
        return seen.get(index);
    }

    @Override
    public void close() {
        server.stop(0);
    }

    private static void send(HttpExchange exchange, Reply reply) throws IOException {
        byte[] bytes = reply.raw() != null
                ? reply.raw()
                : reply.body() == null ? new byte[0] : Json.bytes(reply.body());
        String type = reply.raw() != null ? "application/octet-stream" : "application/json";
        exchange.getResponseHeaders().set("content-type", type);
        reply.headers().forEach(exchange.getResponseHeaders()::set);
        boolean empty = bytes.length == 0;
        exchange.sendResponseHeaders(reply.status(), empty ? -1 : bytes.length);
        if (!empty) {
            exchange.getResponseBody().write(bytes);
        }
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> found = new HashMap<>();
        if (raw == null) {
            return found;
        }
        for (String pair : raw.split("&")) {
            String[] parts = pair.split("=", 2);
            found.put(decode(parts[0]), parts.length > 1 ? decode(parts[1]) : "");
        }
        return found;
    }

    private static String decode(String text) {
        return URLDecoder.decode(text, StandardCharsets.UTF_8);
    }
}
