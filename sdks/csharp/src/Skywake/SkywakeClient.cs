namespace Skywake;

public sealed class SkywakeClient : IDisposable
{
    private readonly HttpClient _client;
    private readonly Http _http;

    public SkywakeClient(SkywakeOptions? options = null)
    {
        options ??= new SkywakeOptions();
        var settings = Settings.Resolve(options);
        Url = Urls.Root(settings.Url);
        Environment = settings.Environment;
        var handler = options.Handler ?? new SocketsHttpHandler { ConnectTimeout = options.Timeout };
        _client = new HttpClient(handler) { Timeout = options.Timeout };
        var headers = new Dictionary<string, string> { ["authorization"] = $"Bearer {settings.Key}" };
        if (Environment is not null)
        {
            headers["skywake-environment"] = Environment;
        }
        _http = new Http(_client, Url + "/v2", headers, new RetryPolicy(options.Retries, options.Backoff));
    }

    public string Url { get; }

    public string? Environment { get; }

    public DiskHandle Disk(string name, string branch = DiskHandle.Main) => new(_http, name, branch);

    public IndexHandle Index(string name, string branch = IndexHandle.Main) => new(_http, name, branch);

    public async Task<DiskHandle> CreateDiskAsync(string name, NewDiskOptions? options = null, CancellationToken ct = default)
    {
        options ??= new NewDiskOptions();
        var body = Json.Object(("name", name), ("region", options.Region), ("search", options.Search), ("visibility", options.Visibility));
        await _http.PostAsync<DiskSummary>("/disks", body, ct).ConfigureAwait(false);
        return Disk(name);
    }

    public async Task<IndexHandle> CreateIndexAsync(string name, NewIndexOptions? options = null, CancellationToken ct = default)
    {
        options ??= new NewIndexOptions();
        var body = Json.Object(("name", name), ("schema", options.Schema), ("region", options.Region), ("embed", options.Embed));
        await _http.PostAsync<IndexSummary>("/indexes", body, ct).ConfigureAwait(false);
        return Index(name);
    }

    public IAsyncEnumerable<DiskSummary> ListDisksAsync(CancellationToken ct = default) => List<DiskSummary>("/disks", ct);

    public IAsyncEnumerable<IndexSummary> ListIndexesAsync(CancellationToken ct = default) => List<IndexSummary>("/indexes", ct);

    public Task<CreatedKey> CreateKeyAsync(NewKey key, CancellationToken ct = default)
    {
        var body = Json.Object(("name", key.Name), ("role", key.Role), ("only", key.Only), ("expires_in_days", key.ExpiresInDays));
        body["environment"] = key.Environment;
        return _http.PostAsync<CreatedKey>("/keys", body, ct);
    }

    public IAsyncEnumerable<ApiKey> ListKeysAsync(CancellationToken ct = default) => List<ApiKey>("/keys", ct);

    public Task RevokeKeyAsync(string id, CancellationToken ct = default) => _http.DeleteAsync($"/keys/{Urls.Segment(id)}", ct);

    public IAsyncEnumerable<EnvironmentInfo> ListEnvironmentsAsync(CancellationToken ct = default) =>
        List<EnvironmentInfo>("/environments", ct);

    public Task<EnvironmentInfo> CreateEnvironmentAsync(string name, CancellationToken ct = default) =>
        _http.PostAsync<EnvironmentInfo>("/environments", Json.Object(("name", name)), ct);

    public Task<Whoami> WhoamiAsync(CancellationToken ct = default) => _http.GetAsync<Whoami>("/whoami", null, ct);

    public void Dispose() => _client.Dispose();

    private IAsyncEnumerable<T> List<T>(string path, CancellationToken ct) =>
        Paging.Pages((cursor, token) => _http.GetAsync<Page<T>>(path, new Dictionary<string, object?> { ["cursor"] = cursor }, token), ct);
}
