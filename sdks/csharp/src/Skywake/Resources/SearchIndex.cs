using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Skywake;

/// <summary>One branch of a search index: main unless <see cref="At"/> picked another.</summary>
public sealed class SearchIndex
{
    /// <summary>The most documents or ids the API takes in one request.</summary>
    internal const int Batch = 1000;

    private readonly ApiTransport _transport;
    private readonly string _path;
    private readonly string _branchPath;

    private SearchIndex(ApiTransport transport, string name, string branch)
    {
        _transport = transport;
        Name = name;
        Branch = branch;
        _path = Indexes.PathOf(name);
        _branchPath = _path + "/branches/" + Urls.Escape(branch);
    }

    internal static SearchIndex Main(ApiTransport transport, string name) => new(transport, name, "main");

    public string Name { get; }

    public string Branch { get; }

    /// <summary>The same index on another branch.</summary>
    public SearchIndex At(string branch) => new(_transport, Name, branch);

    /// <summary>Writes documents, 1000 to a request. Each replaces any earlier one with its id. Returns how many were written.</summary>
    public Task<int> UpsertAsync(IReadOnlyList<Document> documents, CancellationToken ct = default) =>
        BatchedAsync(documents, (part, token) => WrittenAsync("documents", new { documents = part }, token), ct);

    /// <summary>Deletes documents by id, 1000 to a request. Ids that are not there are ignored.</summary>
    public Task<int> DeleteAsync(IReadOnlyList<object> ids, CancellationToken ct = default) =>
        BatchedAsync(ids, (part, token) => WrittenAsync("documents/delete", new { ids = part }, token), ct);

    /// <summary>Applies upserts, patches and deletes as one change.</summary>
    public Task<WriteCounts> WriteAsync(Write write, CancellationToken ct = default) =>
        _transport.CallAsync<WriteCounts>(HttpMethod.Post, _branchPath + "/write", write, ct);

    /// <summary>Sets attributes of documents, 1000 to a request; a null value removes one. Missing documents are skipped.</summary>
    public Task<int> PatchAsync(IReadOnlyList<Patch> patches, CancellationToken ct = default) =>
        BatchedAsync(patches, async (part, token) => (await WriteAsync(new Write { Patches = part }, token).ConfigureAwait(false)).Patched, ct);

    /// <summary>Deletes every document that passes <paramref name="filter"/> and returns how many.</summary>
    public async Task<int> DeleteByAsync(object filter, CancellationToken ct = default) =>
        (await WriteAsync(new Write { DeleteBy = filter }, ct).ConfigureAwait(false)).Deleted;

    /// <summary>The nearest documents to a vector, nearest first.</summary>
    public Task<Results<Hit>> QueryAsync(Query query, CancellationToken ct = default) =>
        ReadAsync<Hit>("query", "hits", query, ct);

    /// <summary>The documents that best match words by BM25, best first.</summary>
    public Task<Results<SearchHit>> SearchAsync(Search search, CancellationToken ct = default) =>
        ReadAsync<SearchHit>("search", "hits", search, ct);

    /// <summary>Named searches on one snapshot, fused by reciprocal rank.</summary>
    public Task<Results<FusedHit>> HybridAsync(Hybrid hybrid, CancellationToken ct = default) =>
        ReadAsync<FusedHit>("hybrid", "hits", hybrid, ct);

    /// <summary>Documents in the order of an attribute, or of "id"; those without it come last.</summary>
    public Task<Results<Row>> OrderAsync(Order order, CancellationToken ct = default) =>
        ReadAsync<Row>("order", "rows", order, ct);

    /// <summary>The documents that pass the filter, best first by an exact score. Those scoring 0 are left out.</summary>
    public Task<Results<Ranked>> RankAsync(Rank rank, CancellationToken ct = default) =>
        ReadAsync<Ranked>("rank", "hits", rank, ct);

    /// <summary>Counts, sums, averages and finds the least and most.</summary>
    public Task<Results<Group>> AggregateAsync(Aggregate aggregate, CancellationToken ct = default) =>
        ReadAsync<Group>("aggregate", "groups", aggregate, ct);

    /// <summary>Several requests on one snapshot. A request may not set its own consistency; set it here.</summary>
    public Task<Results<MultiResult>> MultiAsync(
        IReadOnlyList<MultiRequest> requests, string? consistency = null, CancellationToken ct = default) =>
        ReadAsync<MultiResult>("multi", "results", new MultiBody(requests, consistency), ct);

    /// <summary>Every document as it is now, in no set order, read as it arrives.</summary>
    public async IAsyncEnumerable<Document> ExportAsync([EnumeratorCancellation] CancellationToken ct = default)
    {
        // The answer is one document per line.
        using var reader = new StreamReader(await _transport.OpenAsync(_branchPath + "/export", null, ct).ConfigureAwait(false));
        while (await reader.ReadLineAsync(ct).ConfigureAwait(false) is { } line)
        {
            if (!string.IsNullOrWhiteSpace(line))
            {
                yield return JsonSerializer.Deserialize<Document>(line, JsonDefaults.Options)!;
            }
        }
    }

    /// <summary>Every document as it is now, as the bytes of a Parquet file read as they arrive. Dispose it when done.</summary>
    public Task<Stream> ExportParquetAsync(CancellationToken ct = default) =>
        _transport.OpenAsync(_branchPath + "/export", new Dictionary<string, object> { ["format"] = "parquet" }, ct);

    /// <summary>Copies this branch to a new index, as its main.</summary>
    public async Task<SearchIndex> CopyAsync(CopyIndex to, CancellationToken ct = default)
    {
        var body = JsonSerializer.SerializeToNode(to, JsonDefaults.Options)!.AsObject();
        body["branch"] = Branch;
        await _transport.CallAsync(HttpMethod.Post, _path + "/copy", body, ct).ConfigureAwait(false);
        return Main(_transport, to.Name);
    }

    /// <summary>The document with <paramref name="id"/>. A missing one throws a 404, as a missing index or branch does.</summary>
    public Task<Document> GetAsync(object id, CancellationToken ct = default) =>
        _transport.CallAsync<Document>(HttpMethod.Get, _branchPath + "/documents/" + Urls.Escape(id.ToString()!), null, ct);

    /// <summary>
    /// One page of documents by id, number ids first: at most <paramref name="limit"/> (100 by default),
    /// from <paramref name="cursor"/>, the Next of the page before. It reads every segment, so it is for browsing.
    /// </summary>
    public Task<DocumentPage> DocumentsAsync(int? limit = null, string? cursor = null, CancellationToken ct = default) =>
        _transport.CallAsync<DocumentPage>(HttpMethod.Get, _branchPath + "/documents", null, ct, Paging.Query(limit, "cursor", cursor));

    /// <summary>Every document, a page at a time.</summary>
    public async IAsyncEnumerable<Document> AllDocumentsAsync([EnumeratorCancellation] CancellationToken ct = default)
    {
        string? cursor = null;
        do
        {
            var page = await DocumentsAsync(Paging.Page, cursor, ct).ConfigureAwait(false);
            foreach (var document in page.Documents)
            {
                yield return document;
            }
            cursor = page.Next;
        }
        while (!string.IsNullOrEmpty(cursor));
    }

    /// <summary>Forks this branch as <paramref name="name"/>, at its head or at an older <paramref name="version"/>. Nothing is copied.</summary>
    public async Task<SearchIndex> ForkAsync(string name, string? version = null, CancellationToken ct = default)
    {
        await _transport.CallAsync(HttpMethod.Post, _path + "/branches", new { name, from = Branch, at = version }, ct).ConfigureAwait(false);
        return At(name);
    }

    /// <summary>One page of this branch's versions, newest first, one for every change: at most <paramref name="limit"/> (20 by default), after the version <paramref name="after"/>.</summary>
    public Task<IReadOnlyList<IndexVersion>> VersionsAsync(int? limit = null, string? after = null, CancellationToken ct = default) =>
        _transport.CallAsync<IReadOnlyList<IndexVersion>>(HttpMethod.Get, _branchPath + "/versions", null, ct, Paging.After(limit, after));

    /// <summary>Moves this branch back to an older version, as a new version, which it returns. The history stays.</summary>
    public Task<IndexVersion> RestoreAsync(string version, CancellationToken ct = default) =>
        _transport.CallAsync<IndexVersion>(HttpMethod.Post, _branchPath + "/restore", new { version }, ct);

    /// <summary>
    /// Starts deleting the data of the whole index that no branch uses, nor any version within its
    /// retention. Returns the operation <see cref="OperationAsync"/> follows.
    /// </summary>
    public Task<Operation> CollectAsync(CancellationToken ct = default) =>
        _transport.CallAsync<Operation>(HttpMethod.Post, _path + "/collect", null, ct);

    /// <summary>This branch's counts, or null while the server cannot count them.</summary>
    public async Task<Stats?> StatsAsync(CancellationToken ct = default) =>
        (await _transport.CallAsync<BranchAnswer>(HttpMethod.Get, _branchPath, null, ct).ConfigureAwait(false)).Stats;

    /// <summary>Starts clustering this branch's rows. It answers before the build ends, with an operation <see cref="OperationAsync"/> follows.</summary>
    public Task<Operation> BuildAsync(CancellationToken ct = default) =>
        _transport.CallAsync<Operation>(HttpMethod.Post, _branchPath + "/build", null, ct);

    /// <summary>
    /// Adds the writes of <paramref name="branch"/> since it forked, or was last merged here, to this
    /// branch, and returns how many rows it added. Where both wrote one document, <paramref name="branch"/>'s write wins.
    /// </summary>
    public async Task<int> MergeAsync(string branch, CancellationToken ct = default) =>
        (await _transport.CallAsync(HttpMethod.Post, _branchPath + "/merge", new { from = branch }, ct).ConfigureAwait(false))
        .GetProperty("rows").GetInt32();

    /// <summary>Starts reading this branch into the cache, so the next queries are fast.</summary>
    public Task<Operation> WarmAsync(CancellationToken ct = default) =>
        _transport.CallAsync<Operation>(HttpMethod.Post, _branchPath + "/warm", null, ct);

    /// <summary>A build or warming of this index, and how it went.</summary>
    public Task<Operation> OperationAsync(string id, CancellationToken ct = default) =>
        _transport.CallAsync<Operation>(HttpMethod.Get, _path + "/operations/" + Urls.Escape(id), null, ct);

    /// <summary>Queries with the vectors of documents picked at random, as asked and exactly, and compares them.</summary>
    public Task<RecallResult> RecallAsync(RecallCheck check, CancellationToken ct = default) =>
        _transport.CallAsync<RecallResult>(HttpMethod.Post, _branchPath + "/recall", check, ct);

    /// <summary>One page of the index's branches, in name order: at most <paramref name="limit"/> (1000 by default), after the name <paramref name="after"/>.</summary>
    public Task<IReadOnlyList<Branch>> BranchesAsync(int? limit = null, string? after = null, CancellationToken ct = default) =>
        _transport.CallAsync<IReadOnlyList<Branch>>(HttpMethod.Get, _path + "/branches", null, ct, Paging.After(limit, after));

    /// <summary>Every branch, a page at a time.</summary>
    public IAsyncEnumerable<Branch> AllBranchesAsync(CancellationToken ct = default) =>
        Paging.Every((limit, after, token) => BranchesAsync(limit, after, token), branch => branch.Name, ct);

    /// <summary>Deletes this branch. main stays while the index does.</summary>
    public Task DeleteBranchAsync(CancellationToken ct = default) =>
        _transport.CallAsync(HttpMethod.Delete, _branchPath, null, ct);

    /// <summary>Posts a read and returns the list in its answer's field.</summary>
    private async Task<Results<T>> ReadAsync<T>(string route, string field, object body, CancellationToken ct)
    {
        var answer = await _transport.CallAsync(HttpMethod.Post, _branchPath + "/" + route, body, ct).ConfigureAwait(false);
        TPart? Part<TPart>(string name) where TPart : class =>
            answer.TryGetProperty(name, out var value) ? value.Deserialize<TPart>(JsonDefaults.Options) : null;
        return new Results<T>(
            Part<List<T>>(field) ?? new List<T>(),
            Part<Performance>("performance") ?? new Performance(0, null, 0),
            Part<Billing>("billing") ?? new Billing());
    }

    /// <summary>Sends items 1000 at a time and sums what each answer counts.</summary>
    private static async Task<int> BatchedAsync<T>(
        IReadOnlyList<T> items, Func<IReadOnlyList<T>, CancellationToken, Task<int>> send, CancellationToken ct)
    {
        var total = 0;
        for (var start = 0; start < items.Count; start += Batch)
        {
            total += await send(items.Skip(start).Take(Batch).ToList(), ct).ConfigureAwait(false);
        }
        return total;
    }

    private async Task<int> WrittenAsync(string route, object body, CancellationToken ct) =>
        (await _transport.CallAsync(HttpMethod.Post, _branchPath + "/" + route, body, ct).ConfigureAwait(false))
        .GetProperty("count").GetInt32();

    private sealed record MultiBody(IReadOnlyList<MultiRequest> Requests, string? Consistency);

    private sealed record BranchAnswer(Stats? Stats);
}
