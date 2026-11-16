using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json.Nodes;

namespace Skywake;

public sealed class DiskHandle
{
    public const string Main = "main";

    private const int PageSize = 1000;

    private readonly Http _http;

    internal DiskHandle(Http http, string name, string branch = Main)
    {
        _http = http;
        Name = name;
        Branch = branch;
    }

    public string Name { get; }

    public string Branch { get; }

    private string Root => $"/disks/{Urls.Segment(Name)}";

    private Dictionary<string, object?> OnBranch(string? cursor = null) => new() { ["branch"] = Branch, ["cursor"] = cursor };

    public DiskHandle On(string branch) => new(_http, Name, branch);

    public async Task<string> ReadAsync(string path, ReadOptions? options = null, CancellationToken ct = default) =>
        Encoding.UTF8.GetString(await ReadBytesAsync(path, options, ct).ConfigureAwait(false));

    public async Task<byte[]> ReadBytesAsync(string path, ReadOptions? options = null, CancellationToken ct = default)
    {
        using var response = await ReadResponseAsync(path, options, ct).ConfigureAwait(false);
        return await response.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
    }

    public async Task<Stream> OpenReadAsync(string path, ReadOptions? options = null, CancellationToken ct = default)
    {
        var response = await ReadResponseAsync(path, options, ct).ConfigureAwait(false);
        return await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
    }

    public Task<Committed> WriteAsync(string path, FileContent content, WriteOptions? options = null, CancellationToken ct = default) =>
        WriteAsync(new Dictionary<string, FileContent> { [path] = content }, options, ct);

    public Task<Committed> WriteAsync(
        IReadOnlyDictionary<string, string> files, WriteOptions? options = null, CancellationToken ct = default) =>
        WriteAsync(files.ToDictionary(pair => pair.Key, pair => (FileContent)pair.Value), options, ct);

    public async Task<Committed> WriteAsync(
        IReadOnlyDictionary<string, FileContent> files, WriteOptions? options = null, CancellationToken ct = default)
    {
        options ??= new WriteOptions();
        var changes = await Task.WhenAll(files.Select(pair =>
            Changes.OfAsync(Clean(pair.Key), pair.Value, PartAsync, options.Executable, ct))).ConfigureAwait(false);
        return await CommitAsync(changes, options.Message, ct).ConfigureAwait(false);
    }

    public Task<Committed> DeleteAsync(string path, string? message = null, CancellationToken ct = default) =>
        DeleteAsync(new[] { path }, message, ct);

    public Task<Committed> DeleteAsync(IEnumerable<string> paths, string? message = null, CancellationToken ct = default) =>
        CommitAsync(paths.Select(path => Changes.Deleted(Clean(path))).ToList(), message, ct);

    public Task<Committed> MoveAsync(string from, string to, string? message = null, CancellationToken ct = default)
    {
        var (source, target) = (Clean(from), Clean(to));
        var changes = new[] { Changes.Copied(source, target), Changes.Deleted(source) };
        return CommitAsync(changes, message ?? $"Move {source} to {target}", ct);
    }

    public Task<IReadOnlyList<Entry>> ListAsync(string path = "", ListOptions? options = null, CancellationToken ct = default) =>
        EntriesAsync(path, options ?? new ListOptions(), ct).CollectAsync(ct);

    public async Task<Entry?> StatAsync(string path, string? at = null, CancellationToken ct = default)
    {
        var target = Clean(path);
        if (target.Length == 0)
        {
            return new Entry("", EntryKind.Folder, 0, null, false);
        }
        try
        {
            await foreach (var entry in EntriesAsync(Parent(target), new ListOptions { At = at }, ct).ConfigureAwait(false))
            {
                var order = string.CompareOrdinal(entry.Path, target);
                if (order >= 0)
                {
                    return order == 0 ? entry : null;
                }
            }
        }
        catch (NotFoundException)
        {
            await InfoAsync(ct).ConfigureAwait(false);
        }
        return null;
    }

    public async Task<bool> ExistsAsync(string path, string? at = null, CancellationToken ct = default) =>
        await StatAsync(path, at, ct).ConfigureAwait(false) is not null;

    public async Task<IReadOnlyList<GrepMatch>> GrepAsync(string pattern, GrepOptions? options = null, CancellationToken ct = default)
    {
        options ??= new GrepOptions();
        var body = Json.Object(
            ("pattern", pattern),
            ("path", options.Path),
            ("glob", options.Glob),
            ("ignore_case", options.IgnoreCase),
            ("limit", options.Limit),
            ("at", options.At),
            ("branch", Branch));
        return (await _http.PostAsync<Page<GrepMatch>>($"{Root}/grep", body, ct).ConfigureAwait(false)).Data;
    }

    public async Task<IReadOnlyList<FoundEntry>> FindAsync(string glob, FindOptions? options = null, CancellationToken ct = default)
    {
        options ??= new FindOptions();
        var body = Json.Object(
            ("glob", glob),
            ("path", options.Path),
            ("kind", options.Kind),
            ("limit", options.Limit),
            ("at", options.At),
            ("branch", Branch));
        return (await _http.PostAsync<Page<FoundEntry>>($"{Root}/find", body, ct).ConfigureAwait(false)).Data;
    }

    public async Task<IReadOnlyList<FileHit>> QueryAsync(string text, DiskQueryOptions? options = null, CancellationToken ct = default)
    {
        options ??= new DiskQueryOptions();
        var body = Json.Object(("text", text), ("limit", options.Limit), ("path", options.Path), ("branch", Branch));
        return (await _http.PostAsync<Page<FileHit>>($"{Root}/query", body, ct).ConfigureAwait(false)).Data;
    }

    public async Task<DiskHandle> ForkAsync(string name, string? at = null, CancellationToken ct = default)
    {
        await _http.PostAsync<Branch>($"{Root}/branches", Json.Object(("name", name), ("from", Branch), ("at", at)), ct)
            .ConfigureAwait(false);
        return On(name);
    }

    public Task<DiskMerged> MergeIntoAsync(string into = Main, MergeOptions? options = null, CancellationToken ct = default)
    {
        options ??= new MergeOptions();
        var body = Json.Object(
            ("from", Branch),
            ("into", into),
            ("dry_run", options.DryRun),
            ("message", options.Message),
            ("prefer", options.Prefer));
        return _http.PostAsync<DiskMerged>($"{Root}/merges", body, ct);
    }

    public Task DestroyAsync(CancellationToken ct = default) =>
        _http.DeleteAsync(Branch == Main ? Root : $"{Root}/branches/{Urls.Segment(Branch)}", ct);

    public Task<IReadOnlyList<Branch>> BranchesAsync(CancellationToken ct = default) =>
        Paging.Pages((cursor, token) => _http.GetAsync<Page<Branch>>(
            $"{Root}/branches", new Dictionary<string, object?> { ["cursor"] = cursor }, token), ct).CollectAsync(ct);

    public async Task<string?> HeadAsync(CancellationToken ct = default) =>
        (await _http.GetAsync<DiskBranch>($"{Root}/branches/{Urls.Segment(Branch)}", null, ct).ConfigureAwait(false)).Head;

    public IAsyncEnumerable<Commit> LogAsync(LogOptions? options = null, CancellationToken ct = default)
    {
        options ??= new LogOptions();
        return Paging.Pages((cursor, token) =>
        {
            var query = OnBranch(cursor);
            query["path"] = options.Path;
            query["limit"] = options.Limit;
            return _http.GetAsync<Page<Commit>>($"{Root}/commits", query, token);
        }, ct);
    }

    public Task<IReadOnlyList<DiffChange>> DiffAsync(string against, CancellationToken ct = default) =>
        Paging.Pages((cursor, token) =>
        {
            var query = OnBranch(cursor);
            query["against"] = against;
            return _http.GetAsync<Page<DiffChange>>($"{Root}/diff", query, token);
        }, ct).CollectAsync(ct);

    public Task<Committed> RevertAsync(string commit, string? message = null, CancellationToken ct = default) =>
        _http.PostAsync<Committed>($"{Root}/revert", Json.Object(("commit", commit), ("message", message), ("branch", Branch)), ct);

    public Task<Committed> RestoreAsync(string commit, CancellationToken ct = default) =>
        _http.PostAsync<Committed>($"{Root}/restore", Json.Object(("to", commit), ("branch", Branch)), ct);

    public async Task<Committed> RestoreAsync(DateTimeOffset time, CancellationToken ct = default) =>
        await RestoreAsync(await CommitAtAsync(time, ct).ConfigureAwait(false), ct).ConfigureAwait(false);

    public Task<string?> DownloadAsync(string dir, string? at = null, CancellationToken ct = default) =>
        Folders.DownloadAsync(this, dir, at, ct);

    public Task<string?> UploadAsync(string dir, string? message = null, CancellationToken ct = default) =>
        Folders.UploadAsync(this, dir, message, ct);

    public Task<DiskInfo> InfoAsync(CancellationToken ct = default) => _http.GetAsync<DiskInfo>(Root, null, ct);

    public Task<DiskInfo> ConfigureAsync(DiskSettings settings, CancellationToken ct = default) =>
        _http.PatchAsync<DiskInfo>(Root, Json.Object(("search", settings.Search), ("visibility", settings.Visibility)), ct);

    internal Task<Committed> CommitAsync(IReadOnlyList<JsonObject> changes, string? message, CancellationToken ct) =>
        _http.PostAsync<Committed>(
            $"{Root}/commits", Json.Object(("changes", changes), ("message", message), ("branch", Branch)), ct);

    internal async Task<string> PartAsync(byte[] bytes, CancellationToken ct) =>
        (await _http.CallAsync<Uploaded>(HttpMethod.Post, $"{Root}/uploads", null, Payload.Raw(bytes), ct).ConfigureAwait(false)).Part;

    internal async IAsyncEnumerable<Entry> WalkAsync(string path, string? at, [EnumeratorCancellation] CancellationToken ct)
    {
        await foreach (var entry in EntriesAsync(path, new ListOptions { At = at }, ct).ConfigureAwait(false))
        {
            yield return entry;
            if (entry.Kind == EntryKind.Folder)
            {
                await foreach (var inner in WalkAsync(entry.Path, at, ct).ConfigureAwait(false))
                {
                    yield return inner;
                }
            }
        }
    }

    private IAsyncEnumerable<Entry> EntriesAsync(string path, ListOptions options, CancellationToken ct) =>
        Paging.Pages((cursor, token) =>
        {
            var query = OnBranch(cursor);
            query["path"] = Clean(path);
            query["recursive"] = options.Recursive ? true : null;
            query["at"] = options.At;
            query["limit"] = PageSize;
            return _http.GetAsync<Page<Entry>>($"{Root}/files", query, token);
        }, ct);

    private Task<HttpResponseMessage> ReadResponseAsync(string path, ReadOptions? options, CancellationToken ct)
    {
        options ??= new ReadOptions();
        var query = OnBranch();
        query["at"] = options.At;
        query["offset"] = options.Offset;
        query["length"] = options.Length;
        return _http.SendAsync(HttpMethod.Get, $"{Root}/files/{Urls.FilePath(path)}", query, null, ct);
    }

    private async Task<string> CommitAtAsync(DateTimeOffset time, CancellationToken ct)
    {
        await foreach (var commit in LogAsync(new LogOptions { Limit = 1000 }, ct).ConfigureAwait(false))
        {
            if (commit.Created <= time)
            {
                return commit.Id;
            }
        }
        throw new ArgumentOutOfRangeException(nameof(time), $"disk `{Name}` has no commit from {Times.Iso(time)} or before");
    }

    private static string Clean(string path) => path.Trim('/');

    private static string Parent(string path)
    {
        var slash = path.LastIndexOf('/');
        return slash < 0 ? "" : path[..slash];
    }
}
