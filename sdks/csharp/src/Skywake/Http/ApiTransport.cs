using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Skywake;

/// <summary>Sends requests to the API, retrying them when that is safe.</summary>
internal sealed class ApiTransport : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _base;
    private readonly string _key;
    private readonly RetryPolicy _retry;

    internal ApiTransport(string url, string key, TimeSpan timeout, RetryPolicy retry, HttpMessageHandler? handler)
    {
        _base = Urls.Base(url);
        _key = key;
        _retry = retry;
        _http = new HttpClient(handler ?? new SocketsHttpHandler { ConnectTimeout = timeout }) { Timeout = timeout };
    }

    public void Dispose() => _http.Dispose();

    /// <summary>Sends a request and returns its answer as JSON, or throws the API's error.</summary>
    internal async Task<JsonElement> CallAsync(
        HttpMethod method, string path, object? body, CancellationToken ct, IReadOnlyDictionary<string, object>? query = null)
    {
        using var response = await SendAsync(method, path, query, body, ct).ConfigureAwait(false);
        await ApiErrors.ThrowIfErrorAsync(response, ct).ConfigureAwait(false);
        var bytes = await response.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
        return bytes.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(bytes, JsonDefaults.Options);
    }

    internal async Task<T> CallAsync<T>(
        HttpMethod method, string path, object? body, CancellationToken ct, IReadOnlyDictionary<string, object>? query = null) =>
        (await CallAsync(method, path, body, ct, query).ConfigureAwait(false)).Deserialize<T>(JsonDefaults.Options)!;

    /// <summary>The body of a GET, to be read as it arrives; the caller disposes it.</summary>
    internal async Task<Stream> OpenAsync(string path, IReadOnlyDictionary<string, object>? query, CancellationToken ct)
    {
        var response = await SendAsync(HttpMethod.Get, path, query, null, ct).ConfigureAwait(false);
        try
        {
            await ApiErrors.ThrowIfErrorAsync(response, ct).ConfigureAwait(false);
            return await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        }
        catch
        {
            response.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Sends a request, and again when that is safe. A DELETE that failed may still have landed,
    /// so if a retry of it then finds nothing (404), it answers 204: what it deleted is gone
    /// either way.
    /// </summary>
    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string path, IReadOnlyDictionary<string, object>? query, object? body, CancellationToken ct)
    {
        var payload = body is null ? null : JsonSerializer.SerializeToUtf8Bytes(body, body.GetType(), JsonDefaults.Options);
        var target = new Uri(_base + path + Urls.Query(query));
        var idempotent = RetryPolicy.IsIdempotent(method);
        var mayHaveLanded = false;
        for (var attempt = 0; ; attempt++)
        {
            var last = _retry.IsLast(attempt);
            HttpResponseMessage response;
            try
            {
                response = await _http.SendAsync(Request(method, target, payload), HttpCompletionOption.ResponseHeadersRead, ct)
                    .ConfigureAwait(false);
            }
            // A timeout is a cancellation that the caller did not ask for.
            catch (Exception e) when (e is HttpRequestException || (e is TaskCanceledException && !ct.IsCancellationRequested))
            {
                if (last || !idempotent)
                {
                    throw;
                }
                mayHaveLanded = true;
                await Task.Delay(_retry.Backoff(attempt), ct).ConfigureAwait(false);
                continue;
            }
            var status = (int)response.StatusCode;
            if (mayHaveLanded && method == HttpMethod.Delete && status == 404)
            {
                response.Dispose();
                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }
            if (last || !RetryPolicy.WorthRetrying(status, idempotent))
            {
                return response;
            }
            mayHaveLanded = mayHaveLanded || status >= 500;
            var wait = _retry.After(attempt, response);
            response.Dispose();
            await Task.Delay(wait, ct).ConfigureAwait(false);
        }
    }

    private HttpRequestMessage Request(HttpMethod method, Uri target, byte[]? payload)
    {
        var request = new HttpRequestMessage(method, target);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _key);
        if (payload is not null)
        {
            request.Content = new ByteArrayContent(payload);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        }
        return request;
    }
}
