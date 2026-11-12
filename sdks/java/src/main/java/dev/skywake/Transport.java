package dev.skywake;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse.BodyHandlers;
import java.time.Duration;
import java.util.Map;

/** Sends requests to the API, retrying them when that is safe. */
final class Transport {
    private final HttpClient http;
    private final String base;
    private final String key;
    private final Duration timeout;
    private final Retry retry;

    Transport(String url, String key, Duration timeout, Retry retry) {
        this.base = Urls.base(url);
        this.key = key;
        this.timeout = timeout;
        this.retry = retry;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).build();
    }

    /** Sends a request and returns its answer as JSON, or throws the API's error. */
    JsonNode call(String method, String path, Map<String, ?> query, Object body) {
        Answer answer = send(method, path, query, body);
        try (InputStream in = answer.body()) {
            answer.check();
            return Json.read(in);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    JsonNode call(String method, String path, Object body) {
        return call(method, path, null, body);
    }

    JsonNode get(String path) {
        return call("GET", path, null, null);
    }

    JsonNode get(String path, Map<String, ?> query) {
        return call("GET", path, query, null);
    }

    JsonNode post(String path, Object body) {
        return call("POST", path, null, body);
    }

    /** The body of a GET, to be read as it arrives; the caller closes it. */
    InputStream open(String path, Map<String, ?> query) {
        Answer answer = send("GET", path, query, null);
        try {
            answer.check();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } finally {
            if (answer.status() >= 300) {
                answer.close();
            }
        }
        return answer.body();
    }

    /**
     * Sends a request, and again when that is safe. A DELETE that failed may still have landed,
     * so if a retry of it then finds nothing (404), it answers 204: what it deleted is gone
     * either way.
     */
    Answer send(String method, String path, Map<String, ?> query, Object body) {
        byte[] payload = body == null ? null : Json.write(body);
        URI target = URI.create(base + path + Urls.query(query));
        boolean idempotent = Retry.idempotent(method);
        boolean mayHaveLanded = false;
        for (int attempt = 0; ; attempt++) {
            boolean last = retry.isLast(attempt);
            Answer answer;
            try {
                var response = http.send(request(method, target, payload), BodyHandlers.ofInputStream());
                answer = new Answer(response.statusCode(), response.headers(), response.body());
            } catch (InterruptedException e) {
                throw interrupted();
            } catch (IOException e) {
                if (last || !idempotent) {
                    throw new UncheckedIOException(e);
                }
                mayHaveLanded = true;
                sleep(retry.backoff(attempt));
                continue;
            }
            if (mayHaveLanded && method.equals("DELETE") && answer.status() == 404) {
                answer.close();
                return new Answer(204, answer.headers(), InputStream.nullInputStream());
            }
            if (last || !Retry.worthRetrying(answer.status(), idempotent)) {
                return answer;
            }
            mayHaveLanded = mayHaveLanded || answer.status() >= 500;
            answer.close();
            sleep(retry.after(attempt, answer.headers()));
        }
    }

    private HttpRequest request(String method, URI target, byte[] payload) {
        HttpRequest.Builder request = HttpRequest.newBuilder(target)
                .timeout(timeout)
                .header("Authorization", "Bearer " + key)
                .method(method, payload == null ? BodyPublishers.noBody() : BodyPublishers.ofByteArray(payload));
        if (payload != null) {
            request.header("Content-Type", "application/json");
        }
        return request.build();
    }

    private static void sleep(double seconds) {
        try {
            Thread.sleep((long) (seconds * 1000));
        } catch (InterruptedException e) {
            throw interrupted();
        }
    }

    private static UncheckedIOException interrupted() {
        Thread.currentThread().interrupt();
        return new UncheckedIOException(new InterruptedIOException("interrupted"));
    }
}
