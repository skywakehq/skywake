using System.Text.Json;

namespace Skywake;

/// <summary>The organization's indexes.</summary>
public sealed class Indexes
{
    private readonly ApiTransport _transport;

    internal Indexes(ApiTransport transport) => _transport = transport;

    /// <summary>Makes an index with an empty main branch.</summary>
    public async Task<SearchIndex> CreateAsync(NewIndex index, CancellationToken ct = default)
    {
        await _transport.CallAsync(HttpMethod.Post, "/indexes", index, ct).ConfigureAwait(false);
        return SearchIndex.Main(_transport, index.Name);
    }

    /// <summary>One page of indexes, in name order: at most <paramref name="limit"/> (1000 by default), after the name <paramref name="after"/>.</summary>
    public Task<IReadOnlyList<IndexInfo>> ListAsync(int? limit = null, string? after = null, CancellationToken ct = default) =>
        _transport.CallAsync<IReadOnlyList<IndexInfo>>(HttpMethod.Get, "/indexes", null, ct, Paging.After(limit, after));

    /// <summary>Every index, a page at a time.</summary>
    public IAsyncEnumerable<IndexInfo> AllAsync(CancellationToken ct = default) =>
        Paging.Every((limit, after, token) => ListAsync(limit, after, token), index => index.Name, ct);

    /// <summary>The index, with the counts of main.</summary>
    public Task<IndexInfo> GetAsync(string name, CancellationToken ct = default) =>
        _transport.CallAsync<IndexInfo>(HttpMethod.Get, PathOf(name), null, ct);

    /// <summary>Queries, writes and size per day over the last <paramref name="days"/> days (14 by default), oldest first.</summary>
    public async Task<IReadOnlyList<UsageDay>> UsageAsync(string name, int? days = null, CancellationToken ct = default)
    {
        var query = days is null ? null : new Dictionary<string, object> { ["days"] = days };
        var usage = await _transport.CallAsync<UsageAnswer>(HttpMethod.Get, PathOf(name) + "/usage", null, ct, query).ConfigureAwait(false);
        return usage.Days;
    }

    /// <summary>
    /// Adds attributes, makes the index read-only or writable again, or pins or unpins it. An attribute it has must
    /// keep its type.
    /// </summary>
    public Task<IndexInfo> UpdateAsync(string name, UpdateIndex update, CancellationToken ct = default)
    {
        var body = JsonSerializer.SerializeToNode(update, JsonDefaults.Options)!.AsObject();
        // A null retention keeps every version and a null pinned unpins; null fields are otherwise left out.
        if (update.KeepAllVersions)
        {
            body["retention_days"] = null;
        }
        if (update.Unpin)
        {
            body["pinned"] = null;
        }
        return _transport.CallAsync<IndexInfo>(HttpMethod.Patch, PathOf(name), body, ct);
    }

    /// <summary>Deletes the index, every branch and all its data.</summary>
    public Task DeleteAsync(string name, CancellationToken ct = default) =>
        _transport.CallAsync(HttpMethod.Delete, PathOf(name), null, ct);

    internal static string PathOf(string name) => "/indexes/" + Urls.Escape(name);

    private sealed record UsageAnswer(IReadOnlyList<UsageDay> Days);
}
