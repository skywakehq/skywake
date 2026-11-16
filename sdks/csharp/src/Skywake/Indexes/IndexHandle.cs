using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Skywake;

public sealed class IndexHandle
{
    public const string Main = "main";

    private const int PageSize = 1000;
    private const int UpsertCount = 10_000;
    private const long UpsertBytes = 24L * 1024 * 1024;

    private readonly Http _http;

    internal IndexHandle(Http http, string name, string branch = Main)
    {
        _http = http;
        Name = name;
        Branch = branch;
    }

    public string Name { get; }

    public string Branch { get; }

    private string Root => $"/indexes/{Urls.Segment(Name)}";

    private Dictionary<string, object?> OnBranch(string? cursor = null, int? limit = null) =>
        new() { ["branch"] = Branch, ["cursor"] = cursor, ["limit"] = limit };

    public IndexHandle On(string branch) => new(_http, Name, branch);

    public Task<Upserted> UpsertAsync(object row, CancellationToken ct = default) => UpsertAsync(new[] { row }, ct);

    public async Task<Upserted> UpsertAsync(IEnumerable<object> rows, CancellationToken ct = default)
    {
        var ids = new List<JsonElement>();
        long count = 0;
        foreach (var batch in Batches.Split(rows.Select(Json.Bytes), UpsertCount, UpsertBytes, row => row.Length))
        {
            var payload = new Payload(JsonArray(batch), "application/json");
            var done = await _http.CallAsync<Upserted>(HttpMethod.Post, $"{Root}/rows", OnBranch(), payload, ct).ConfigureAwait(false);
            ids.AddRange(done.Ids);
            count += done.Count;
        }
        return new Upserted(ids, count);
    }

    public async Task<long> UpdateAsync(Target target, object fields, CancellationToken ct = default)
    {
        var body = target.Body();
        body["fields"] = Json.Node(fields);
        return (await _http.PatchAsync<Counted>($"{Root}/rows", body, ct, OnBranch()).ConfigureAwait(false)).Count;
    }

    public async Task<long> DeleteAsync(Target target, CancellationToken ct = default) =>
        (await _http.PostAsync<Counted>($"{Root}/rows/delete", target.Body(), ct, OnBranch()).ConfigureAwait(false)).Count;

    public Task<JsonObject?> GetAsync(long id, CancellationToken ct = default) => GetAsync(id.ToString(System.Globalization.CultureInfo.InvariantCulture), ct);

    public async Task<JsonObject?> GetAsync(string id, CancellationToken ct = default)
    {
        try
        {
            return await _http.GetAsync<JsonObject>($"{Root}/rows/{Urls.Segment(id)}", OnBranch(), ct).ConfigureAwait(false);
        }
        catch (NotFoundException error) when (error.Path == "id")
        {
            return null;
        }
    }

    public Task<IReadOnlyList<JsonObject>> QueryAsync(QueryOptions options, CancellationToken ct = default) =>
        QueryAsync(null, options, ct);

    public async Task<IReadOnlyList<JsonObject>> QueryAsync(
        string? text, QueryOptions? options = null, CancellationToken ct = default)
    {
        options ??= new QueryOptions();
        var body = Json.Object(
            ("text", text),
            ("vector", options.Vector),
            ("filter", options.Filter),
            ("limit", options.Limit),
            ("mode", options.Mode),
            ("sort", options.Sort),
            ("fields", options.Fields),
            ("branch", Branch));
        return (await _http.PostAsync<Page<JsonObject>>($"{Root}/query", body, ct).ConfigureAwait(false)).Data;
    }

    public async Task<long> CountAsync(object? filter = null, CancellationToken ct = default) =>
        (await _http.PostAsync<Counted>($"{Root}/count", Json.Object(("filter", filter), ("branch", Branch)), ct)
            .ConfigureAwait(false)).Count;

    public async Task<IReadOnlyList<JsonObject>> AggregateAsync(AggregateOptions options, CancellationToken ct = default)
    {
        var body = Json.Object(
            ("group_by", options.GroupBy),
            ("count", options.Count),
            ("sum", options.Sum),
            ("avg", options.Avg),
            ("min", options.Min),
            ("max", options.Max),
            ("filter", options.Filter),
            ("branch", Branch));
        return (await _http.PostAsync<Page<JsonObject>>($"{Root}/aggregate", body, ct).ConfigureAwait(false)).Data;
    }

    public IAsyncEnumerable<JsonObject> RowsAsync(object? filter = null, CancellationToken ct = default) =>
        filter is null
            ? Paging.Pages((cursor, token) => _http.GetAsync<Page<JsonObject>>($"{Root}/rows", OnBranch(cursor, PageSize), token), ct)
            : MatchingAsync(filter, ct);

    public async Task<IndexHandle> ForkAsync(string name, string? at = null, CancellationToken ct = default)
    {
        await _http.PostAsync<Branch>($"{Root}/branches", Json.Object(("name", name), ("from", Branch), ("at", at)), ct)
            .ConfigureAwait(false);
        return On(name);
    }

    public Task<IndexMerged> MergeIntoAsync(string into = Main, CancellationToken ct = default) =>
        _http.PostAsync<IndexMerged>($"{Root}/merges", Json.Object(("from", Branch), ("into", into)), ct);

    public Task DestroyAsync(CancellationToken ct = default) =>
        _http.DeleteAsync(Branch == Main ? Root : $"{Root}/branches/{Urls.Segment(Branch)}", ct);

    public Task<IReadOnlyList<Branch>> BranchesAsync(CancellationToken ct = default) =>
        Paging.Pages((cursor, token) => _http.GetAsync<Page<Branch>>(
            $"{Root}/branches", new Dictionary<string, object?> { ["cursor"] = cursor }, token), ct).CollectAsync(ct);

    public Task<IReadOnlyList<IndexVersion>> VersionsAsync(CancellationToken ct = default) =>
        Paging.Pages((cursor, token) => _http.GetAsync<Page<IndexVersion>>($"{Root}/versions", OnBranch(cursor), token), ct)
            .CollectAsync(ct);

    public Task<IndexVersion> RestoreAsync(DateTimeOffset time, CancellationToken ct = default) =>
        RestoreAsync(Times.Iso(time), ct);

    public Task<IndexVersion> RestoreAsync(string version, CancellationToken ct = default) =>
        _http.PostAsync<IndexVersion>($"{Root}/restore", Json.Object(("to", version), ("branch", Branch)), ct);

    public async Task<IndexHandle> CopyAsync(string name, string? environment = null, CancellationToken ct = default)
    {
        await _http.PostAsync<IndexSummary>($"{Root}/copy", Json.Object(("name", name), ("environment", environment)), ct)
            .ConfigureAwait(false);
        return new IndexHandle(environment is null ? _http : _http.In(environment), name);
    }

    public Task<IndexInfo> InfoAsync(CancellationToken ct = default) => _http.GetAsync<IndexInfo>(Root, null, ct);

    public Task<IndexInfo> ConfigureAsync(IndexSettings settings, CancellationToken ct = default)
    {
        var body = Json.Object(
            ("read_only", settings.ReadOnly),
            ("retention_days", settings.RetentionDays),
            ("pinned", settings.Pinned),
            ("attributes", settings.Attributes),
            ("drop_attributes", settings.DropAttributes));
        return _http.PatchAsync<IndexInfo>(Root, body, ct);
    }

    private async IAsyncEnumerable<JsonObject> MatchingAsync(object filter, [EnumeratorCancellation] CancellationToken ct)
    {
        JsonNode? after = null;
        while (true)
        {
            var where = after is null
                ? filter
                : new JsonObject { ["and"] = new JsonArray(Json.Node(filter), new JsonObject { ["id"] = new JsonObject { ["gt"] = after } }) };
            var hits = await QueryAsync(new QueryOptions { Filter = where, Limit = PageSize }, ct).ConfigureAwait(false);
            foreach (var hit in hits)
            {
                hit.Remove("score");
                yield return hit;
            }
            if (hits.Count < PageSize)
            {
                yield break;
            }
            after = hits[^1]["id"]?.DeepClone();
        }
    }

    private static byte[] JsonArray(List<byte[]> rows)
    {
        using var stream = new MemoryStream();
        stream.WriteByte((byte)'[');
        for (var i = 0; i < rows.Count; i++)
        {
            if (i > 0)
            {
                stream.WriteByte((byte)',');
            }
            stream.Write(rows[i]);
        }
        stream.WriteByte((byte)']');
        return stream.ToArray();
    }
}
