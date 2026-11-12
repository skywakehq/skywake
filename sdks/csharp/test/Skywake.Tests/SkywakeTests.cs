using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace Skywake.Tests;

public class SkywakeTests
{
    /// <summary>A request the fake API got.</summary>
    private sealed record Seen(string Method, string Path, string Query, JsonNode? Body);

    /// <summary>An API that answers with a function and records each request.</summary>
    private sealed class FakeApi(Func<Seen, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public List<Seen> Got { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Assert.Equal("Bearer sw_key", request.Headers.Authorization?.ToString());
            var text = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            var seen = new Seen(
                request.Method.Method,
                request.RequestUri!.AbsolutePath,
                request.RequestUri.Query.TrimStart('?'),
                text.Length == 0 ? null : JsonNode.Parse(text));
            lock (Got)
            {
                Got.Add(seen);
            }
            return answer(seen);
        }
    }

    private static (SkywakeClient, List<Seen>) Fake(Func<Seen, HttpResponseMessage> answer)
    {
        var api = new FakeApi(answer);
        var sky = new SkywakeClient("http://api.test/v1/", "sw_key", backoff: TimeSpan.FromMilliseconds(1), handler: api);
        return (sky, api.Got);
    }

    private static HttpResponseMessage Reply(int status, object body) => Text(status, JsonSerializer.Serialize(body));

    private static HttpResponseMessage Text(int status, string text) =>
        new((HttpStatusCode)status) { Content = new StringContent(text, Encoding.UTF8, "application/json") };

    // Through JSON, so numbers and maps compare as the wire has them.
    private static void Same(object want, JsonNode? got) =>
        Assert.True(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(want), got), $"got {got?.ToJsonString()}");

    [Fact]
    public async Task AnUpsertIsSent1000DocumentsAtATimeToTheBranchPicked()
    {
        var (sky, got) = Fake(seen => Reply(200, new { count = seen.Body!["documents"]!.AsArray().Count }));
        var docs = Enumerable.Range(0, 2500)
            .Select(i => new Document(i, new Dictionary<string, object?> { ["v"] = new float[] { i, 0 } }))
            .ToList();
        Assert.Equal(2500, await sky.Index("prod/products").At("agents/try").UpsertAsync(docs));
        Assert.All(got, seen => Assert.Equal("/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents", seen.Path));
        Assert.Equal(new[] { 1000, 1000, 500 }, got.Select(seen => seen.Body!["documents"]!.AsArray().Count));
        // A document without attributes leaves them out.
        Assert.False(got[0].Body!["documents"]![0]!.AsObject().ContainsKey("attributes"));
    }

    [Fact]
    public async Task AQuerySendsOnlyWhatIsGivenAndGivesPerformance()
    {
        var (sky, got) = Fake(_ => Reply(200, new
        {
            hits = new[] { new { id = "a", distance = 0.1, attributes = new { } } },
            performance = new { server_ms = 3, cache_temperature = "warm", cache_hit_ratio = 0.5 },
            billing = new { queries = 1 },
        }));
        var filter = new { tag = new { eq = "billing" } };
        var hits = await sky.Index("products").QueryAsync(
            new Query(new Vector("embedding", new[] { 0.5f, 0.25f })) { TopK = 5, Filter = filter });
        Same(new { vector = new { column = "embedding", value = new[] { 0.5, 0.25 } }, topK = 5, filter }, got[0].Body);
        Assert.Equal("/v1/indexes/products/branches/main/query", got[0].Path);
        Assert.Equal("a", hits.Items[0].Id);
        Assert.Equal("warm", hits.Performance.CacheTemperature);
        Assert.Equal(1, hits.Billing.Queries);
    }

    [Fact]
    public async Task APatchKeepsTheNullThatRemovesAnAttribute()
    {
        var (sky, got) = Fake(_ => Reply(200, new { upserted = 0, patched = 1, deleted = 0 }));
        var patch = new Patch(1, new Dictionary<string, object?> { ["tag"] = null });
        Assert.Equal(1, await sky.Index("x").PatchAsync(new[] { patch }));
        Assert.Equal("""{"patches":[{"id":1,"attributes":{"tag":null}}]}""", got[0].Body!.ToJsonString());
    }

    [Fact]
    public async Task A429IsRetriedAsAskedButAFailedPostIsNot()
    {
        var tries = 0;
        var (sky, got) = Fake(seen =>
        {
            if (seen.Path == "/v1/indexes/x/branches/main/write")
            {
                return Reply(503, new { error = "down" });
            }
            if (++tries < 3)
            {
                var slow = Reply(429, new { error = "slow down", code = "rate_limited" });
                slow.Headers.TryAddWithoutValidation("Retry-After", "0.01");
                return slow;
            }
            return Reply(200, new { rows = Array.Empty<object>() });
        });
        await sky.Index("x").OrderAsync(new Order("id"));
        Assert.Equal(3, got.Count);
        var e = await Assert.ThrowsAsync<SkywakeException>(() => sky.Index("x").WriteAsync(new Write { Deletes = new object[] { 1 } }));
        Assert.Equal(503, e.Status);
        Assert.Equal(4, got.Count);
    }

    [Fact]
    public async Task ADeleteRetriedAfterAFailureCountsANotFoundAsDone()
    {
        var tries = 0;
        // The first try may have deleted it before failing; the retry finds nothing.
        var (sky, got) = Fake(_ => ++tries == 1
            ? Reply(502, new { error = "bad gateway" })
            : Reply(404, new { error = "no such branch" }));
        await sky.Index("x").At("old").DeleteBranchAsync();
        Assert.Equal(2, got.Count);
        Assert.Equal("DELETE", got[1].Method);
    }

    [Fact]
    public async Task AnErrorSaysWhatWasWrongAndWhere()
    {
        var (sky, got) = Fake(_ => Reply(400, new
        {
            error = "must be a number",
            code = "invalid",
            request_id = "req-1",
            path = "filter.price.lt",
        }));
        var e = await Assert.ThrowsAsync<SkywakeException>(() => sky.Index("products").SearchAsync(new Search("x")));
        Assert.Equal(
            new object?[] { 400, "must be a number", "invalid", "req-1", "filter.price.lt" },
            new object?[] { e.Status, e.Message, e.Code, e.RequestId, e.Path });
        Assert.Single(got); // a 4xx is not retried
    }

    [Fact]
    public async Task RankAndMultiGiveTheirHitsAndBilling()
    {
        var ranked = new[] { new { id = 2, score = 6, attributes = new { } } };
        var (sky, got) = Fake(seen => seen.Path == "/v1/indexes/docs/branches/main/rank"
            ? Reply(200, new { hits = ranked, billing = new { queries = 1 } })
            : Reply(200, new
            {
                results = new object[] { new { rank = ranked }, new { aggregate = Array.Empty<object>() } },
                billing = new { queries = 2 },
            }));
        var score = new { dot = new { attribute = "terms", indices = new[] { 2 }, values = new[] { 3.0 } } };
        var hits = await sky.Index("docs").RankAsync(new Rank(score) { TopK = 3 });
        Assert.Equal(6, hits.Items[0].Score);
        Assert.Equal(1, hits.Billing.Queries);
        Same(new { score, topK = 3 }, got[0].Body);

        var measures = new Dictionary<string, IReadOnlyList<string>> { ["n"] = new[] { "count" } };
        var results = await sky.Index("docs").MultiAsync(
            new[] { new MultiRequest { Rank = new Rank(score) }, new MultiRequest { Aggregate = new Aggregate(measures) } },
            "eventual");
        Assert.Equal(2L, results.Items[0].Rank![0].Id);
        Assert.Equal(2, results.Billing.Queries);
        Same(new
        {
            requests = new object[] { new { rank = new { score } }, new { aggregate = new { measures = new { n = new[] { "count" } } } } },
            consistency = "eventual",
        }, got[1].Body);
    }

    [Fact]
    public async Task AnExportIsReadOneDocumentAtATime()
    {
        var (sky, got) = Fake(_ => Text(200, "{\"id\":1,\"vectors\":{\"v\":[1]}}\n\n{\"id\":\"b\",\"attributes\":{\"n\":2}}\n"));
        var ids = new List<object>();
        await foreach (var doc in sky.Index("x").ExportAsync())
        {
            ids.Add(doc.Id);
        }
        Assert.Equal(new object[] { 1L, "b" }, ids);
        Assert.Equal("/v1/indexes/x/branches/main/export", got[0].Path);
    }

    [Fact]
    public async Task EveryBranchIsReadAPageAtATime()
    {
        var names = Enumerable.Range(0, 1001)
            .Select(i => new { name = $"b{i:D4}", forked_from = "main", created = "" })
            .ToList();
        var (sky, got) = Fake(seen => Reply(200, seen.Query == "limit=1000" ? names.Take(1000) : names.Skip(1000)));
        var count = 0;
        await foreach (var _ in sky.Index("x").AllBranchesAsync())
        {
            count++;
        }
        Assert.Equal(1001, count);
        Assert.Equal("limit=1000&after=b0999", got[1].Query);
    }

    [Fact]
    public async Task EveryDocumentIsReadAPageAtATime()
    {
        var (sky, got) = Fake(seen => seen.Query == "limit=1000"
            ? Reply(200, new { documents = new[] { new { id = 1 } }, next = "c1" })
            : Reply(200, new { documents = new[] { new { id = 2 } }, next = (string?)null }));
        var ids = new List<object>();
        await foreach (var doc in sky.Index("x").AllDocumentsAsync())
        {
            ids.Add(doc.Id);
        }
        Assert.Equal(new object[] { 1L, 2L }, ids);
        Assert.Equal("limit=1000&cursor=c1", got[1].Query);
    }

    [Fact]
    public async Task ReadsOfOneValueGoToTheirRoutes()
    {
        var (sky, got) = Fake(seen => seen.Path switch
        {
            "/v1/indexes/x/branches/a%2Fb" => Reply(200, new { name = "a/b", stats = new { rows = 7 } }),
            "/v1/indexes/x/branches/main/merge" => Reply(200, new { rows = 2 }),
            _ => Reply(202, new { id = "op_1", status = "running" }),
        });
        Assert.Equal(7, (await sky.Index("x").At("a/b").StatsAsync())!.Rows);
        Assert.Equal(2, await sky.Index("x").MergeAsync("a/b"));
        Assert.Equal("op_1", (await sky.Index("x").BuildAsync()).Id);
        Same(new { from = "a/b" }, got[1].Body);
    }

    [Fact]
    public async Task AnIndexIsMadeWithOnlyWhatIsGiven()
    {
        var (sky, got) = Fake(_ => Reply(201, new { name = "docs" }));
        var docs = await sky.Indexes.CreateAsync(new NewIndex("docs",
            new Schema(new[] { new VectorColumn("embedding", 3) }, new[] { new AttributeColumn("title", "text") })));
        Assert.Equal("docs", docs.Name);
        Same(new
        {
            name = "docs",
            schema = new
            {
                vectors = new[] { new { name = "embedding", dims = 3 } },
                attributes = new[] { new { name = "title", type = "text" } },
            },
        }, got[0].Body);
        await docs.CopyAsync(new CopyIndex("docs2") { Encryption = new Encryption("key-1") });
        Same(new { name = "docs2", encryption = new { kms_key_id = "key-1" }, branch = "main" }, got[1].Body);
        await sky.Indexes.UpdateAsync("docs", new UpdateIndex { ReadOnly = true });
        Same(new { read_only = true }, got[2].Body);
        await sky.Index("docs").HybridAsync(new Hybrid(new Dictionary<string, object> { ["words"] = new Search("reset") { TopK = 50 } }));
        Same(new { searches = new { words = new { query = "reset", topK = 50 } }, fuse = new { } }, got[3].Body);
    }
    [Fact]
    public async Task AnIndexIsPinnedUnpinnedAndSaysWhere()
    {
        var (sky, got) = Fake(_ => Reply(200, new
        {
            name = "a",
            pinned = new { replicas = 1 },
            pinning = new { replicas = new[] { new { server = "api-1", warm = true, in_flight = 2 } } },
        }));
        var schema = new Schema(Array.Empty<VectorColumn>(), Array.Empty<AttributeColumn>());
        await sky.Indexes.CreateAsync(new NewIndex("a", schema) { Pinned = new Pinned(2) });
        Same(new { replicas = 2 }, got[0].Body!["pinned"]);
        await sky.Indexes.UpdateAsync("a", new UpdateIndex { Pinned = new Pinned(3) });
        Same(new { pinned = new { replicas = 3 } }, got[1].Body);
        await sky.Indexes.UpdateAsync("a", new UpdateIndex { Unpin = true });
        Assert.Equal("""{"pinned":null}""", got[2].Body!.ToJsonString());
        var index = await sky.Indexes.GetAsync("a");
        Assert.Equal(new Pinned(1), index.Pinned);
        Assert.Equal(new PinnedReplica("api-1", true, 2), Assert.Single(index.Pinning!.Replicas));
    }

    [Fact]
    public async Task AnAttributeSendsItsTextOptionsAndFilterIndex()
    {
        var (sky, got) = Fake(_ => Reply(201, new { }));
        await sky.Indexes.CreateAsync(new NewIndex("docs", new Schema(Array.Empty<VectorColumn>(), new[]
        {
            new AttributeColumn("body", "text") { Language = "french", Stopwords = true },
            new AttributeColumn("tag", "string") { FilterIndex = true },
        })));
        Same(new
        {
            name = "docs",
            schema = new
            {
                vectors = Array.Empty<object>(),
                attributes = new object[]
                {
                    new { name = "body", type = "text", language = "french", stopwords = true },
                    new { name = "tag", type = "string", filter_index = true },
                },
            },
        }, got[0].Body);
    }

    [Fact]
    public async Task AWriteAsksForTheIdsItChangedAndAnIndexMayTakeUuids()
    {
        var (sky, got) = Fake(seen => seen.Path == "/v1/indexes"
            ? Reply(201, new { name = "b" })
            : Reply(200, new { upserted = 0, patched = 0, deleted = 1, deleted_ids = new[] { "a" } }));
        var counts = await sky.Index("a").WriteAsync(new Write { Deletes = new object[] { "a" }, ReturnAffectedIds = true });
        Assert.Equal(new object[] { "a" }, counts.DeletedIds);
        Assert.Null(counts.UpsertedIds);
        Same(new { deletes = new[] { "a" }, returnAffectedIds = true }, got[0].Body);
        await sky.Indexes.CreateAsync(new NewIndex("b",
            new Schema(new[] { new VectorColumn("v", 1) }, Array.Empty<AttributeColumn>()) { Id = "uuid" }));
        Same(new
        {
            name = "b",
            schema = new { vectors = new[] { new { name = "v", dims = 1 } }, attributes = Array.Empty<object>(), id = "uuid" },
        }, got[1].Body);
    }

    [Fact]
    public async Task VersionsRestoreForkAtCollectAndParquetGoToTheirRoutes()
    {
        var version = new string('a', 64);
        var (sky, got) = Fake(seen => seen.Path switch
        {
            var path when path.EndsWith("/versions") => Reply(200, new[] { new { version, time = "", rows = 1 } }),
            var path when path.EndsWith("/restore") => Reply(200, new { version, time = "", rows = 1 }),
            var path when path.EndsWith("/collect") => Reply(202, new { id = "op_2", kind = "collect", status = "running" }),
            var path when path.EndsWith("/export") => Text(200, "PAR1"),
            _ => Reply(201, new { }),
        });
        var main = sky.Index("products");
        Assert.Equal(1, (await main.VersionsAsync(5, version))[0].Rows);
        Assert.Equal(version, (await main.RestoreAsync(version)).Version);
        Assert.Equal("past", (await main.ForkAsync("past", version)).Branch);
        var op = await main.CollectAsync();
        Assert.Equal(("op_2", "collect"), (op.Id, op.Kind));
        await using (var file = await main.ExportParquetAsync())
        {
            Assert.Equal("PAR1", await new StreamReader(file).ReadToEndAsync());
        }
        await sky.Indexes.UpdateAsync("products", new UpdateIndex { RetentionDays = 7 });
        await sky.Indexes.UpdateAsync("products", new UpdateIndex { KeepAllVersions = true });
        Assert.Equal(new[]
        {
            "GET /v1/indexes/products/branches/main/versions?limit=5&after=" + version,
            "POST /v1/indexes/products/branches/main/restore?",
            "POST /v1/indexes/products/branches?",
            "POST /v1/indexes/products/collect?",
            "GET /v1/indexes/products/branches/main/export?format=parquet",
            "PATCH /v1/indexes/products?",
            "PATCH /v1/indexes/products?",
        }, got.Select(seen => $"{seen.Method} {seen.Path}?{seen.Query}"));
        Same(new { version }, got[1].Body);
        Same(new { name = "past", from = "main", at = version }, got[2].Body);
        Same(new { retention_days = 7 }, got[5].Body);
        Assert.Equal("""{"retention_days":null}""", got[6].Body!.ToJsonString());
    }

    [Fact]
    public async Task UsageDaysMayHaveNoRowsOrBytes()
    {
        var (sky, _) = Fake(_ => Reply(200, new
        {
            days = new object[]
            {
                new { day = "2026-11-10", queries = 3, writes = 1, deletes = 0, embeddings = 0, reranks = 0, rows = (long?)null, bytes = (long?)null },
                new { day = "2026-11-11", queries = 0, writes = 0, deletes = 0, embeddings = 0, reranks = 0, rows = 2L, bytes = 224L },
            },
        }));
        var days = await sky.Indexes.UsageAsync("docs");
        Assert.Null(days[0].Rows);
        Assert.Equal(3, days[0].Queries);
        Assert.Equal(224, days[1].Bytes);
    }
}
