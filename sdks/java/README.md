# Skywake for Java

Disks: shared, branchable file systems for AI agents, with search as a switch
on each disk. Java 17+, with Jackson for JSON.

```xml
<dependency>
  <groupId>dev.skywake</groupId>
  <artifactId>skywake</artifactId>
  <version>0.4.0</version>
</dependency>
```

```java
Skywake sky = new Skywake();

Disk app = sky.createDisk("app", new DiskOptions().search(true));
app.write("notes.md", "hello");
List<FileHit> hits = app.query("hello");

Disk work = app.fork("agent-1");
work.write("notes.md", "changed");
work.mergeInto("main");
```

- **Settings.** `new Skywake()` reads `SKYWAKE_API_KEY`, `SKYWAKE_URL` and
  `SKYWAKE_ENV`, then the profile in `~/.config/skywake/credentials.toml` that
  `skywake login` writes. `Skywake.builder()` sets `key`, `url`, `environment`,
  `profile`, `retries` and `timeout` in code.
- **Handles.** `sky.disk(name)` makes no call; pass a branch as the second
  argument. `fork` returns a handle on the new branch.
- **Options** are small objects: `new FileQueryOptions().limit(5).path("docs")`.
- **Lists** such as `listDisks()` and `log()` are `Iterable`s that
  fetch a page at a time.
- **Errors** extend `SkywakeException` (`status()`, `code()`, `hint()`,
  `requestId()`, `path()`): `AuthException`, `PermissionException`,
  `NotFoundException`, `ConflictException`, `MergeConflictException`
  (`conflicts()`), `InvalidRequestException`, `RateLimitedException`
  (`retryAfter()`) and `ServerException`.

Tests: `mvn test`. The scenario test runs against a server when
`SKYWAKE_SCENARIO_URL` and `SKYWAKE_SCENARIO_KEY` are set:
`mvn -q test -Dtest=ScenarioTest`.
