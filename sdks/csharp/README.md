# Skywake for .NET

Disks: shared, branchable file systems for AI agents, with search as a switch
on each disk. Runs on .NET 8+, no dependencies. Its tests need the .NET 10 SDK.

```bash
dotnet add package Skywake
```

```csharp
using Skywake;

using var sky = new SkywakeClient();

var app = await sky.CreateDiskAsync("app", new NewDiskOptions { Search = true });
await app.WriteAsync("README.md", "# App\n");
var hits = await app.QueryAsync("app", new DiskQueryOptions { Limit = 5 });

var work = await app.ForkAsync("agent-1");
await work.WriteAsync("notes.md", "from the agent", new WriteOptions { Message = "notes" });
await work.MergeIntoAsync("main");
```

- **Settings.** The key comes from `SkywakeOptions.Key`, then `SKYWAKE_API_KEY`,
  then the profile `skywake login` wrote. The URL and environment work the same
  way (`SKYWAKE_URL`, `SKYWAKE_ENV`, `SKYWAKE_PROFILE`).
- **Disks.** `ReadAsync`, `WriteAsync` (one file or many, one commit),
  `DeleteAsync`, `MoveAsync`, `ListAsync`, `GrepAsync`, `FindAsync`,
  `QueryAsync` (when search is on), `ForkAsync`, `MergeIntoAsync`, `LogAsync`,
  `DiffAsync`, `RevertAsync`, `RestoreAsync`, `DownloadAsync` and `UploadAsync`
  for a whole folder.
- **Lists** are `IAsyncEnumerable<T>`.
- **Errors** are `SkywakeException`: `AuthException`, `PermissionException`,
  `NotFoundException`, `ConflictException`, `MergeConflictException`,
  `RateLimitedException`, `ServerException` and `InvalidRequestException`.

Tests: `dotnet test`. The scenarios run against a server when
`SKYWAKE_SCENARIO_URL` and `SKYWAKE_SCENARIO_KEY` are set:
`dotnet test --filter FullyQualifiedName~Scenario`.
