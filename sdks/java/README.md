# Skywake for Java

A client for Skywake search indexes. Java 17+, with Jackson for JSON.

```xml
<dependency>
  <groupId>dev.skywake</groupId>
  <artifactId>skywake</artifactId>
  <version>0.1.0</version>
</dependency>
```

```java
var sky = new Skywake("https://api.skywake.dev", System.getenv("SKYWAKE_KEY"));

SearchIndex products = sky.indexes().create(new NewIndex("products", new Schema(
        List.of(new VectorColumn("embedding", 3)),
        List.of(new Attribute("title", "text"), new Attribute("price", "number")))));
products.upsert(List.of(new Document(1,
        Map.of("embedding", new float[] {0.1f, 0.2f, 0.3f}),
        Map.of("title", "Desk lamp", "price", 40))));

Results<Hit> hits = products.query(new Query("embedding", new float[] {0.1f, 0.2f, 0.3f})
        .topK(5)
        .filter(Map.of("price", Map.of("lt", 50))));
System.out.println(hits.items() + " " + hits.performance().serverMs());
```

- **Branches.** `products.fork("try")` copies nothing; `at(branch)` reads
  another; `merge("try")` brings its writes back.
- **History.** `versions()` lists a branch's versions; `restore(version)` and
  `fork(name, version)` go back in time; `collect()` frees what no version keeps.
- **Reads.** `query`, `search` (BM25), `hybrid`, `order`, `rank` (sparse and
  late-interaction scores), `aggregate`, and `multi` for several on one snapshot.
  Each returns `items()`, `performance()` and `billing()`.
- **Writes.** `upsert`, `patch` and `delete` send 1,000 at a time; `write` is one
  change with conditions.
- **Lists.** `allBranches()`, `allDocuments()`, `indexes().all()` and `export()`
  are streams that read a page at a time. Close an export you stop early.
- **Errors** are `SkywakeException` with `status()`, `code()`, `requestId()` and,
  for a bad request, the `path()` of the field that is wrong. A 429 is always
  retried; a network error or 5xx only for GET, PUT and DELETE.

Tests: `mvn test`.
