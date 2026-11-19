# Skywake for Java

An open-source search index on your own bucket: vector and full-text search,
filters and aggregates over rows, with branches you can fork and merge.
Java 17+, with Jackson for JSON.

```xml
<dependency>
  <groupId>dev.skywake</groupId>
  <artifactId>skywake</artifactId>
  <version>0.2.0</version>
</dependency>
```

```java
Skywake sky = new Skywake();

Index products = sky.index("products");
products.upsert(Map.of("id", 1, "text", "red running shoes", "price", 89));
List<Map<String, Object>> hits = products.query("shoes for running");

Index draft = products.fork("draft");
draft.update(1, Map.of("price", 79));
draft.mergeInto("main");
```

- **Settings.** `new Skywake()` reads `SKYWAKE_API_KEY`, `SKYWAKE_URL` and
  `SKYWAKE_ENV`, then the profile in `~/.config/skywake/credentials.toml` that
  `skywake login` writes. `Skywake.builder()` sets `key`, `url`, `environment`,
  `profile`, `retries` and `timeout` in code.
- **Handles.** `sky.index(name)` makes no call; pass a branch as the second
  argument. `fork` returns a handle on the new branch.
- **Options** are small objects: `new QueryOptions().limit(5).mode(Mode.KEYWORDS)`.
- **Lists** such as `listIndexes()`, `rows()` and `listKeys()` are `Iterable`s that
  fetch a page at a time.
- **Errors** extend `SkywakeException` (`status()`, `code()`, `hint()`,
  `requestId()`, `path()`): `AuthException`, `PermissionException`,
  `NotFoundException`, `ConflictException`, `MergeConflictException`
  (`conflicts()`), `InvalidRequestException`, `RateLimitedException`
  (`retryAfter()`) and `ServerException`.

Tests: `mvn test`. The scenario test runs against a server when
`SKYWAKE_SCENARIO_URL` and `SKYWAKE_SCENARIO_KEY` are set:
`mvn -q test -Dtest=ScenarioTest`.
