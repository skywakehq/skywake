package dev.skywake;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.Optional;
import javax.net.ssl.SSLSession;

record Done(HttpRequest request) implements HttpResponse<InputStream> {
    @Override
    public int statusCode() {
        return 204;
    }

    @Override
    public Optional<HttpResponse<InputStream>> previousResponse() {
        return Optional.empty();
    }

    @Override
    public HttpHeaders headers() {
        return HttpHeaders.of(Map.of(), (name, value) -> true);
    }

    @Override
    public InputStream body() {
        return InputStream.nullInputStream();
    }

    @Override
    public Optional<SSLSession> sslSession() {
        return Optional.empty();
    }

    @Override
    public URI uri() {
        return request.uri();
    }

    @Override
    public HttpClient.Version version() {
        return HttpClient.Version.HTTP_1_1;
    }
}
