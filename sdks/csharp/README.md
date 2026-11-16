# Skywake for .NET

Disks (files with branches) and search indexes, for AI agents. Runs on .NET 8+,
no dependencies. Its tests need the .NET 10 SDK.

```bash
dotnet add package Skywake
```

```csharp
using Skywake;

using var sky = new SkywakeClient();

var products = sky.Index("products");
await products.UpsertAsync(new { id = "mug", text = "a blue coffee mug", price = 12 });
var hits = await products.QueryAsync("coffee", new QueryOptions { Limit = 5 });

var app = sky.Disk("app");
await app.WriteAsync("README.md", "# App\n");
var work = await app.ForkAsync("agent-1");
await work.WriteAsync("notes.md", "from the agent", new WriteOptions { Message = "notes" });
await work.MergeIntoAsync("main");
```

- **Settings.** The key comes from `SkywakeOptions.Key`, then `SKYWAKE_API_KEY`,
  then the profile `skywake login` wrote. The URL and environment work the same
  way (`SKYWAKE_URL`, `SKYWAKE_ENV`, `SKYWAKE_PROFILE`).
- **Indexes.** `UpsertAsync` takes one row or any number; `UpdateAsync`,
  `DeleteAsync` (an id, ids, or `Target.Where(filter)`), `GetAsync`,
  `QueryAsync`, `CountAsync`, `AggregateAsync`, `RowsAsync`, `ForkAsync`,
  `MergeIntoAsync`, `VersionsAsync`, `RestoreAsync`, `CopyAsync`.
- **Disks.** `ReadAsync`, `WriteAsync` (one file or many, one commit),
  `DeleteAsync`, `MoveAsync`, `ListAsync`, `GrepAsync`, `FindAsync`,
  `QueryAsync`, `LogAsync`, `DiffAsync`, `RevertAsync`, `RestoreAsync`,
  `DownloadAsync` and `UploadAsync` for a whole folder.
- **Lists** are `IAsyncEnumerable<T>`; rows and hits are `JsonObject`.
- **Errors** are `SkywakeException`: `AuthException`, `PermissionException`,
  `NotFoundException`, `ConflictException`, `MergeConflictException`,
  `RateLimitedException`, `ServerException` and `InvalidRequestException`.

Tests: `dotnet test`. The scenarios run against a server when
`SKYWAKE_SCENARIO_URL` and `SKYWAKE_SCENARIO_KEY` are set:
`dotnet test --filter FullyQualifiedName~Scenario`.
