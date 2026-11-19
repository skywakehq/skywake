# Skywake for .NET

The .NET client for Skywake, the open-source search index: vector and
full-text search over rows kept in your own bucket. Runs on .NET 8+, no
dependencies. Its tests need the .NET 10 SDK.

```bash
dotnet add package Skywake
```

```csharp
using Skywake;

using var sky = new SkywakeClient();

var products = sky.Index("products");
await products.UpsertAsync(new { id = "mug", text = "a blue coffee mug", price = 12 });
var hits = await products.QueryAsync("coffee", new QueryOptions { Limit = 5 });
var cheap = await products.QueryAsync("coffee", new QueryOptions { Filter = new { price = new { lt = 20 } } });

var draft = await products.ForkAsync("draft");
await draft.UpdateAsync("mug", new { price = 9 });
await draft.MergeIntoAsync("main");
```

- **Settings.** The key comes from `SkywakeOptions.Key`, then `SKYWAKE_API_KEY`,
  then the profile `skywake login` wrote. The URL and environment work the same
  way (`SKYWAKE_URL`, `SKYWAKE_ENV`, `SKYWAKE_PROFILE`).
- **Indexes.** `CreateIndexAsync`, `ListIndexesAsync` and `DestroyAsync`.
  `UpsertAsync` takes one row or any number; `UpdateAsync`, `DeleteAsync`
  (an id, ids, or `Target.Where(filter)`), `GetAsync`, `QueryAsync` (text,
  vector, filter, sort), `CountAsync`, `AggregateAsync`, `RowsAsync`.
- **Branches and versions.** `ForkAsync`, `MergeIntoAsync`, `BranchesAsync`,
  `VersionsAsync`, `RestoreAsync`, `CopyAsync`.
- **Account.** `WhoamiAsync`, `CreateKeyAsync`, `ListKeysAsync`,
  `RevokeKeyAsync`, `ListEnvironmentsAsync`, `CreateEnvironmentAsync`.
- **Lists** are `IAsyncEnumerable<T>`; rows and hits are `JsonObject`.
- **Errors** are `SkywakeException`: `AuthException`, `PermissionException`,
  `NotFoundException`, `ConflictException`, `MergeConflictException`,
  `RateLimitedException`, `ServerException` and `InvalidRequestException`.

Tests: `dotnet test`. The scenarios run against a server when
`SKYWAKE_SCENARIO_URL` and `SKYWAKE_SCENARIO_KEY` are set:
`dotnet test --filter FullyQualifiedName~Scenario`.
