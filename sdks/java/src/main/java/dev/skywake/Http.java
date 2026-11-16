package dev.skywake;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublisher;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

final class Http {
    private static final String JSON = "application/json";
    private static final String BYTES = "application/octet-stream";

    private final HttpClient client;
    private final String base;
    private final Map<String, String> headers;
    private final Retry retry;
    private final Duration timeout;

    Http(String base, Map<String, String> headers, Retry retry, Duration timeout) {
        this(HttpClient.newBuilder().connectTimeout(timeout).build(), base, headers, retry, timeout);
    }

    private Http(HttpClient client, String base, Map<String, String> headers, Retry retry, Duration timeout) {
        this.client = client;
        this.base = base;
        this.headers = Map.copyOf(headers);
        this.retry = retry;
        this.timeout = timeout;
    }

    Http in(String environment) {
        Map<String, String> changed = new HashMap<>(headers);
        changed.put("skywake-environment", environment);
        return new Http(client, base, changed, retry, timeout);
    }

    JsonNode get(String path, Map<String, ?> query) {
        return call("GET", path, query, null);
    }

    JsonNode post(String path, Object json) {
        return call("POST", path, null, json);
    }

    JsonNode post(String path, Object json, Map<String, ?> query) {
        return call("POST", path, query, json);
    }

    JsonNode patch(String path, Object json, Map<String, ?> query) {
        return call("PATCH", path, query, json);
    }

    void delete(String path) {
        call("DELETE", path, null, null);
    }

    JsonNode call(String method, String path, Map<String, ?> query, Object json) {
        byte[] payload = json == null ? null : Json.bytes(json);
        return Json.tree(drain(send(method, path, query, payload, JSON)));
    }

    JsonNode upload(String path, byte[] bytes) {
        return Json.tree(drain(send("POST", path, null, bytes, BYTES)));
    }

    InputStream open(String path, Map<String, ?> query) {
        return send("GET", path, query, null, null).body();
    }

    private HttpResponse<InputStream> send(
            String method, String path, Map<String, ?> query, byte[] payload, String type) {
        HttpRequest request = request(method, URI.create(base + path + Urls.query(query)), payload, type);
        HttpResponse<InputStream> response = attempt(request);
        if (response.statusCode() >= 400) {
            throw Errors.of(response.statusCode(), response.headers(), drain(response));
        }
        return response;
    }

    private HttpResponse<InputStream> attempt(HttpRequest request) {
        String method = request.method();
        boolean idempotent = Retry.idempotent(method);
        boolean mayHaveLanded = false;
        for (int attempt = 0; ; attempt++) {
            boolean last = retry.last(attempt);
            HttpResponse<InputStream> response;
            try {
                response = client.send(request, BodyHandlers.ofInputStream());
            } catch (IOException e) {
                if (last || !idempotent) {
                    throw new UncheckedIOException(e);
                }
                mayHaveLanded = true;
                sleep(retry.backoffMs(attempt));
                continue;
            } catch (InterruptedException e) {
                throw interrupted();
            }
            int status = response.statusCode();
            if (mayHaveLanded && method.equals("DELETE") && status == 404) {
                drain(response);
                return new Done(request);
            }
            if (last || !Retry.again(status, idempotent)) {
                return response;
            }
            mayHaveLanded = mayHaveLanded || status >= 500;
            drain(response);
            sleep(retry.waitMs(attempt, response.headers()));
        }
    }

    private HttpRequest request(String method, URI uri, byte[] payload, String type) {
        BodyPublisher body = payload == null ? BodyPublishers.noBody() : BodyPublishers.ofByteArray(payload);
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri).timeout(timeout).method(method, body);
        headers.forEach(builder::header);
        if (payload != null) {
            builder.header("content-type", type);
        }
        return builder.build();
    }

    private static byte[] drain(HttpResponse<InputStream> response) {
        try (InputStream body = response.body()) {
            return body.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            throw interrupted();
        }
    }

    private static UncheckedIOException interrupted() {
        Thread.currentThread().interrupt();
        return new UncheckedIOException(new InterruptedIOException("interrupted"));
    }
}
