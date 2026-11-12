# Skywake for .NET

A client for Skywake search indexes. Runs on .NET 8+, no dependencies. Its tests
need the .NET 10 SDK.

```bash
dotnet add package Skywake
```

```csharp
using var sky = new SkywakeClient("https://api.skywake.dev", Environment.GetEnvironmentVariable("SKYWAKE_KEY")!);

var products = await sky.Indexes.CreateAsync(new NewIndex("products", new Schema(
    new[] { new VectorColumn("embedding", 3) },
    new[] { new AttributeColumn("title", "text"), new AttributeColumn("price", "number") })));
await products.UpsertAsync(new[] { new Document(1,
    new Dictionary<string, object?> { ["embedding"] = new[] { 0.1f, 0.2f, 0.3f } },
    new Dictionary<string, object?> { ["title"] = "Desk lamp", ["price"] = 40 }) });

var hits = await products.QueryAsync(new Query(new Vector("embedding", new[] { 0.1f, 0.2f, 0.3f }))
{
    TopK = 5,
    Filter = new { price = new { lt = 50 } },
});
Console.WriteLine($"{hits.Items.Count} {hits.Performance.ServerMs}");
```

- **Branches.** `products.ForkAsync("try")` copies nothing; `At(branch)` reads
  another; `MergeAsync("try")` brings its writes back.
- **History.** `VersionsAsync` lists a branch's versions; `RestoreAsync(version)`
  and `ForkAsync(name, version)` go back in time; `CollectAsync` frees what no
  version keeps.
- **Reads.** `QueryAsync`, `SearchAsync` (BM25), `HybridAsync`, `OrderAsync`,
  `RankAsync` (sparse and late-interaction scores), `AggregateAsync`, and
  `MultiAsync` for several on one snapshot. Each returns `Items`, `Performance`
  and `Billing`.
- **Writes.** `UpsertAsync`, `PatchAsync` and `DeleteAsync` send 1,000 at a time;
  `WriteAsync` is one change with conditions.
- **Lists.** `AllBranchesAsync`, `AllDocumentsAsync`, `Indexes.AllAsync` and
  `ExportAsync` are `await foreach`-able and read a page at a time.
- **Errors** are `SkywakeException` with `Status`, `Code`, `RequestId` and, for a
  bad request, the `Path` of the field that is wrong. A 429 is always retried; a
  network error or 5xx only for GET, PUT and DELETE.

Tests: `dotnet test`.
