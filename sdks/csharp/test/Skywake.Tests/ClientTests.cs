using System.Text;
using System.Text.Json.Nodes;
using Xunit;
using static Skywake.Tests.FakeApi;

namespace Skywake.Tests;

public class ClientTests
{
    [Fact]
    public async Task RequestsGoToV2WithTheKeyAndTheEnvironment()
    {
        var api = new FakeApi((_, _) => new Reply(Body: new { organization = "acme", environment = "prod", role = "admin" }));
        var me = await api.Client(new SkywakeOptions { Environment = "prod" }).WhoamiAsync();
        Assert.Equal("prod", me.Environment);
        Assert.Equal(Role.Admin, me.Role);
        Assert.Equal("/v2/whoami", api.Seen[0].Path);
        Assert.Equal("Bearer k", api.Seen[0].Headers["authorization"]);
        Assert.Equal("prod", api.Seen[0].Headers["skywake-environment"]);
    }

    [Fact]
    public async Task EachStatusBecomesItsOwnErrorWithTheHintInTheMessage()
    {
        var replies = new[]
        {
            Failure(401, "unauthorized"),
            Failure(403, "forbidden"),
            Failure(404, "not_found", new { hint = "did you mean `products`?" }),
            Failure(500, "internal"),
        };
        var api = new FakeApi((_, count) => replies[Math.Min(count, 4) - 1]);
        var sky = api.Client(new SkywakeOptions { Retries = 0 });
        await Assert.ThrowsAsync<AuthException>(() => sky.WhoamiAsync());
        await Assert.ThrowsAsync<PermissionException>(() => sky.WhoamiAsync());
        var missing = await Assert.ThrowsAsync<NotFoundException>(() => sky.Disk("prodcts").InfoAsync());
        Assert.Equal("did you mean `products`?", missing.Hint);
        Assert.Equal("nope; did you mean `products`?", missing.Message);
        Assert.Equal("req-1", missing.RequestId);
        Assert.Equal(404, missing.Status);
        Assert.Equal("not_found", missing.Code);
        await Assert.ThrowsAsync<ServerException>(() => sky.WhoamiAsync());
    }

    [Fact]
    public async Task A429IsRetriedAsTheServerAsksThenReportedWithRetryAfter()
    {
        var limited = Failure(429, "rate_limited") with { Headers = new Dictionary<string, string> { ["retry-after"] = "1" } };
        var api = new FakeApi((_, _) => limited);
        var error = await Assert.ThrowsAsync<RateLimitedException>(() => api.Client(new SkywakeOptions { Retries = 1 }).WhoamiAsync());
        Assert.Equal(TimeSpan.FromSeconds(1), error.RetryAfter);
        Assert.Equal(2, api.Seen.Count);
    }

    [Fact]
    public async Task AFailedGetIsRetriedButAFailedPostIsNot()
    {
        var api = new FakeApi((seen, count) => count == 1 || seen.Method == "POST" ? Failure(503, "unavailable") : new Reply(Body: new { organization = "o", role = "read" }));
        var sky = api.Client();
        Assert.Equal("o", (await sky.WhoamiAsync()).Organization);
        await Assert.ThrowsAsync<ServerException>(() => sky.CreateEnvironmentAsync("prod"));
        Assert.Equal(3, api.Seen.Count);
    }

    [Fact]
    public async Task ADeleteThatMayHaveLandedAndThenFindsNothingIsDone()
    {
        var api = new FakeApi((_, count) => count == 1 ? Failure(502, "bad_gateway") : Failure(404, "not_found"));
        await api.Client().Disk("app").DestroyAsync();
        Assert.Equal(2, api.Seen.Count);
    }

    [Fact]
    public async Task AMergeThatCannotFinishIsAMergeConflictListingWhatConflicts()
    {
        var api = new FakeApi((_, _) => Failure(409, "conflict", new { conflicts = new[] { "README.md" } }));
        var work = api.Client().Disk("app", "agent-1");
        var error = await Assert.ThrowsAsync<MergeConflictException>(() => work.MergeIntoAsync());
        Assert.Equal(new[] { "README.md" }, error.Conflicts);
        Assert.IsAssignableFrom<ConflictException>(error);
        Same(new { from = "agent-1", into = "main" }, api.Seen[0].Json);
    }

    [Fact]
    public async Task ListsFollowNextUntilTheLastPage()
    {
        var api = new FakeApi((seen, _) => seen.Query["cursor"] == "b"
            ? new Reply(Body: new { data = new[] { Disk("c") }, next = (string?)null })
            : new Reply(Body: new { data = new[] { Disk("a"), Disk("b") }, next = "b" }));
        var names = new List<string>();
        await foreach (var disk in api.Client().ListDisksAsync())
        {
            names.Add(disk.Name);
        }
        Assert.Equal(new[] { "a", "b", "c" }, names);
    }

    [Fact]
    public async Task QueryOnADiskSendsTheTextOptionsAndBranch()
    {
        var api = new FakeApi((_, _) => new Reply(Body: new
        {
            data = new[] { new { path = "docs/coffee.md", score = 0.9, snippet = "brew coffee" } },
            next = (string?)null,
        }));
        var hits = await api.Client().Disk("app", "draft").QueryAsync("coffee", new DiskQueryOptions { Limit = 3, Path = "docs" });
        Assert.Equal("docs/coffee.md", hits[0].Path);
        Assert.Equal("/v2/disks/app/query", api.Seen[0].Path);
        Same(new { text = "coffee", limit = 3, path = "docs", branch = "draft" }, api.Seen[0].Json);
    }

    [Fact]
    public async Task FilesAreReadAndWrittenByPathEachPartOfItEncoded()
    {
        var api = new FakeApi((seen, _) => seen.Method == "GET"
            ? new Reply(Raw: Encoding.UTF8.GetBytes("hello"))
            : new Reply(Body: new { commit = "c1", changed = true }));
        var app = api.Client().Disk("app");
        Assert.Equal("hello", await app.ReadAsync("/docs/a b.md", new ReadOptions { At = "c0" }));
        Assert.Equal(Encoding.UTF8.GetBytes("hello"), await app.ReadBytesAsync("x"));
        var done = await app.WriteAsync(
            new Dictionary<string, FileContent> { ["a.md"] = "one", ["b.bin"] = new byte[] { 0xff, 0x00 } },
            new WriteOptions { Message = "two" });
        Assert.Equal("c1", done.Commit);
        Assert.Equal("/v2/disks/app/files/docs/a%20b.md", api.Seen[0].Path);
        Assert.Equal("c0", api.Seen[0].Query["at"]);
        Same(new
        {
            message = "two",
            branch = "main",
            changes = new object[] { new { path = "a.md", text = "one" }, new { path = "b.bin", base64 = "/wA=" } },
        }, api.Seen[2].Json);
    }

    [Fact]
    public async Task ALargeFileGoesUpInPartsBeforeItsCommit()
    {
        var api = new FakeApi((seen, _) => seen.Path.EndsWith("/uploads")
            ? new Reply(201, new { part = $"p{seen.Body.Length}", size = seen.Body.Length })
            : new Reply(Body: new { commit = "c1", changed = true }));
        await api.Client().Disk("app").WriteAsync("big.bin", new byte[20 * 1024 * 1024]);
        var parts = api.Seen.Where(seen => seen.Path.EndsWith("/uploads")).ToList();
        Assert.Equal(new[] { 16 * 1024 * 1024, 4 * 1024 * 1024 }, parts.Select(seen => seen.Body.Length));
        Same(new[] { new { path = "big.bin", parts = new[] { $"p{16 * 1024 * 1024}", $"p{4 * 1024 * 1024}" } } }, api.Seen[^1].Json!["changes"]);
    }

    [Fact]
    public async Task AForkIsAHandleOnTheNewBranchAndDestroyRemovesJustTheBranch()
    {
        var api = new FakeApi((seen, _) => seen.Method == "DELETE" ? new Reply(204) : new Reply(201, new { name = "agent-1" }));
        var work = await api.Client().Disk("app").ForkAsync("agent-1", "c3");
        Assert.Equal("agent-1", work.Branch);
        await work.DestroyAsync();
        Same(new { name = "agent-1", from = "main", at = "c3" }, api.Seen[0].Json);
        Assert.Equal(("DELETE", "/v2/disks/app/branches/agent-1"), (api.Seen[1].Method, api.Seen[1].Path));
    }

    [Fact]
    public async Task RestoreToATimePicksTheNewestCommitAtOrBeforeIt()
    {
        var api = new FakeApi((seen, _) => seen.Method == "GET"
            ? new Reply(Body: new
            {
                data = new[]
                {
                    new { id = "c3", message = "", created = "2026-01-03T00:00:00Z", merged = (string?)null },
                    new { id = "c2", message = "", created = "2026-01-02T00:00:00Z", merged = (string?)null },
                },
                next = (string?)null,
            })
            : new Reply(Body: new { commit = "c4", changed = true }));
        await api.Client().Disk("app").RestoreAsync(DateTimeOffset.Parse("2026-01-02T12:00:00Z"));
        Same(new { to = "c2", branch = "main" }, api.Seen[1].Json);
    }

    private static JsonObject Disk(string name) =>
        new() { ["name"] = name, ["region"] = "r", ["visibility"] = "private", ["created"] = "2026-01-01T00:00:00Z" };
}
