namespace Skywake;

/// <summary>A client of the Skywake API. It is safe to share between threads.</summary>
public sealed class SkywakeClient : IDisposable
{
    private readonly ApiTransport _transport;

    /// <summary>
    /// A client of the API at <paramref name="url"/>, with an API key (sw_...) or a console token.
    /// <paramref name="timeout"/> (60 seconds by default) is how long one try may wait to connect,
    /// and then for the answer to start; an answer that keeps arriving, such as an export, is never
    /// cut off. A failed request is tried up to <paramref name="retries"/> more times when that is
    /// safe: after a 429 always, and after a network error or a 5xx for GET, PUT and DELETE. It waits
    /// about <paramref name="backoff"/> (0.2 seconds by default), doubled each time, or as long as
    /// the server asks (at most 60 seconds).
    /// </summary>
    public SkywakeClient(
        string url,
        string key,
        TimeSpan? timeout = null,
        int retries = 3,
        TimeSpan? backoff = null,
        HttpMessageHandler? handler = null)
    {
        var retry = new RetryPolicy(retries, backoff ?? TimeSpan.FromMilliseconds(200));
        _transport = new ApiTransport(url, key, timeout ?? TimeSpan.FromSeconds(60), retry, handler);
        Indexes = new Indexes(_transport);
    }

    /// <summary>Makes, lists, reads and deletes search indexes.</summary>
    public Indexes Indexes { get; }

    /// <summary>A search index, on its main branch.</summary>
    public SearchIndex Index(string name) => SearchIndex.Main(_transport, name);

    public void Dispose() => _transport.Dispose();
}
