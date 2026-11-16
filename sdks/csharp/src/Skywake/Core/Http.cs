using System.Net;

namespace Skywake;

internal sealed class Http
{
    private readonly HttpClient _client;
    private readonly string _base;
    private readonly IReadOnlyDictionary<string, string> _headers;
    private readonly RetryPolicy _retry;

    internal Http(HttpClient client, string baseUrl, IReadOnlyDictionary<string, string> headers, RetryPolicy retry)
    {
        _client = client;
        _base = baseUrl;
        _headers = headers;
        _retry = retry;
    }

    internal Http In(string environment) =>
        new(_client, _base, new Dictionary<string, string>(_headers) { ["skywake-environment"] = environment }, _retry);

    internal Task<T> GetAsync<T>(string path, IReadOnlyDictionary<string, object?>? query, CancellationToken ct) =>
        CallAsync<T>(HttpMethod.Get, path, query, null, ct);

    internal Task<T> PostAsync<T>(
        string path, object body, CancellationToken ct, IReadOnlyDictionary<string, object?>? query = null) =>
        CallAsync<T>(HttpMethod.Post, path, query, Payload.Json(body), ct);

    internal Task<T> PatchAsync<T>(
        string path, object body, CancellationToken ct, IReadOnlyDictionary<string, object?>? query = null) =>
        CallAsync<T>(HttpMethod.Patch, path, query, Payload.Json(body), ct);

    internal async Task DeleteAsync(string path, CancellationToken ct)
    {
        using var response = await SendAsync(HttpMethod.Delete, path, null, null, ct).ConfigureAwait(false);
    }

    internal async Task<T> CallAsync<T>(
        HttpMethod method, string path, IReadOnlyDictionary<string, object?>? query, Payload? payload, CancellationToken ct)
    {
        using var response = await SendAsync(method, path, query, payload, ct).ConfigureAwait(false);
        var bytes = await response.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
        return bytes.Length == 0 ? default! : Json.Parse<T>(bytes);
    }

    internal async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string path, IReadOnlyDictionary<string, object?>? query, Payload? payload, CancellationToken ct)
    {
        var target = new Uri(_base + path + Urls.Query(query));
        var response = await RetryingAsync(method, target, payload, ct).ConfigureAwait(false);
        if (response.IsSuccessStatusCode)
        {
            return response;
        }
        using (response)
        {
            var body = await response.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
            throw ErrorReader.From(response, body);
        }
    }

    private async Task<HttpResponseMessage> RetryingAsync(HttpMethod method, Uri target, Payload? payload, CancellationToken ct)
    {
        var idempotent = RetryPolicy.IsIdempotent(method);
        var mayHaveLanded = false;
        for (var attempt = 0; ; attempt++)
        {
            var last = _retry.IsLast(attempt);
            HttpResponseMessage response;
            try
            {
                response = await _client
                    .SendAsync(Request(method, target, payload), HttpCompletionOption.ResponseHeadersRead, ct)
                    .ConfigureAwait(false);
            }
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

    private HttpRequestMessage Request(HttpMethod method, Uri target, Payload? payload)
    {
        var request = new HttpRequestMessage(method, target) { Content = payload?.Content() };
        foreach (var (name, value) in _headers)
        {
            request.Headers.TryAddWithoutValidation(name, value);
        }
        return request;
    }
}
