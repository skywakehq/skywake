package dev.skywake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class SkywakeTest {
    /** A request the fake API got. */
    record Seen(String method, String path, String query, JsonNode body) {}

    interface Answer {
        void answer(Seen seen, HttpExchange exchange) throws IOException;
    }

    private HttpServer server;
    private final List<Seen> got = Collections.synchronizedList(new ArrayList<>());

    /** Runs an API that answers with {@code answer} and records each request. */
    private Skywake fake(Answer answer) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try {
                assertEquals("Bearer sw_key", exchange.getRequestHeaders().getFirst("Authorization"));
                byte[] body = exchange.getRequestBody().readAllBytes();
                Seen seen = new Seen(
                        exchange.getRequestMethod(),
                        exchange.getRequestURI().getRawPath(),
                        exchange.getRequestURI().getRawQuery(),
                        body.length == 0 ? null : Skywake.JSON.readTree(body));
                got.add(seen);
                answer.answer(seen, exchange);
            } catch (Throwable e) {
                reply(exchange, 599, Map.of("error", String.valueOf(e)));
            } finally {
                exchange.close();
            }
        });
        server.start();
        return new Skywake("http://127.0.0.1:" + server.getAddress().getPort() + "/v1/", "sw_key",
                Duration.ofSeconds(5), 3, Duration.ofMillis(1));
    }

    @AfterEach
    void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    private static void reply(HttpExchange exchange, int status, Object body) throws IOException {
        send(exchange, status, Skywake.JSON.writeValueAsString(body));
    }

    private static void send(HttpExchange exchange, int status, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    private static void same(Object want, JsonNode got) {
        assertEquals(Skywake.JSON.valueToTree(want), got);
    }

    @Test
    void anUpsertIsSent1000DocumentsAtATimeToTheBranchPicked() throws IOException {
        Skywake sky = fake((seen, exchange) ->
                reply(exchange, 200, Map.of("count", seen.body().get("documents").size())));
        List<Document> docs = IntStream.range(0, 2500)
                .mapToObj(i -> new Document(i, Map.of("v", new float[] {i, 0}), null))
                .collect(Collectors.toList());
        assertEquals(2500, sky.index("prod/products").at("agents/try").upsert(docs));
        List<Integer> sizes = new ArrayList<>();
        for (Seen seen : got) {
            assertEquals("/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents", seen.path());
            sizes.add(seen.body().get("documents").size());
        }
        assertEquals(List.of(1000, 1000, 500), sizes);
        // A document without attributes leaves them out.
        assertEquals(false, got.get(0).body().get("documents").get(0).has("attributes"));
    }

    @Test
    void aQuerySendsOnlyWhatIsGivenAndGivesPerformance() throws IOException {
        Map<String, Object> answer = Map.of(
                "hits", List.of(Map.of("id", "a", "distance", 0.1, "attributes", Map.of())),
                "performance", Map.of("server_ms", 3, "cache_temperature", "warm", "cache_hit_ratio", 0.5),
                "billing", Map.of("queries", 1));
        Skywake sky = fake((seen, exchange) -> reply(exchange, 200, answer));
        Map<String, Object> filter = Map.of("tag", Map.of("eq", "billing"));
        Results<Hit> hits = sky.index("products")
                .query(new Query("embedding", new float[] {0.5f, 0.25f}).topK(5).filter(filter));
        same(Map.of(
                        "vector", Map.of("column", "embedding", "value", List.of(0.5, 0.25)),
                        "topK", 5,
                        "filter", filter),
                got.get(0).body());
        assertEquals("/v1/indexes/products/branches/main/query", got.get(0).path());
        assertEquals("a", hits.items().get(0).id());
        assertEquals("warm", hits.performance().cacheTemperature());
        assertEquals(1, hits.billing().queries());
    }

    @Test
    void aDayWithoutASizeSnapshotHasNoRowsOrBytes() throws IOException {
        Map<String, Object> empty = new HashMap<>(Map.of(
                "day", "2026-11-10", "queries", 0, "writes", 0, "deletes", 0, "embeddings", 0, "reranks", 0));
        empty.put("rows", null);
        empty.put("bytes", null);
        Map<String, Object> full = new HashMap<>(empty);
        full.put("day", "2026-11-11");
        full.put("rows", 3);
        full.put("bytes", 40);
        Skywake sky = fake((seen, exchange) -> reply(exchange, 200, Map.of("days", List.of(empty, full))));
        List<UsageDay> days = sky.indexes().usage("x", 2);
        assertEquals(null, days.get(0).rows());
        assertEquals(null, days.get(0).bytes());
        assertEquals(3L, days.get(1).rows());
    }

    @Test
    void aPatchKeepsTheNullThatRemovesAnAttribute() throws IOException {
        Skywake sky = fake((seen, exchange) -> reply(exchange, 200, Map.of("upserted", 0, "patched", 1, "deleted", 0)));
        Map<String, Object> attributes = new HashMap<>();
        attributes.put("tag", null);
        assertEquals(1, sky.index("x").patch(List.of(new Patch(1, attributes))));
        assertEquals("{\"patches\":[{\"id\":1,\"attributes\":{\"tag\":null}}]}", got.get(0).body().toString());
    }

    @Test
    void a429IsRetriedAsAskedButAFailedPostIsNot() throws IOException {
        int[] tries = {0};
        Skywake sky = fake((seen, exchange) -> {
            if (seen.path().equals("/v1/indexes/x/branches/main/write")) {
                reply(exchange, 503, Map.of("error", "down"));
                return;
            }
            if (++tries[0] < 3) {
                exchange.getResponseHeaders().set("Retry-After", "0.01");
                reply(exchange, 429, Map.of("error", "slow down", "code", "rate_limited"));
                return;
            }
            reply(exchange, 200, Map.of("rows", List.of()));
        });
        sky.index("x").order(new Order("id"));
        assertEquals(3, got.size());
        SkywakeException e = assertThrows(SkywakeException.class,
                () -> sky.index("x").write(new Write().deletes(List.of(1))));
        assertEquals(503, e.status());
        assertEquals(4, got.size());
    }

    @Test
    void aDeleteRetriedAfterAFailureCountsANotFoundAsDone() throws IOException {
        int[] tries = {0};
        Skywake sky = fake((seen, exchange) -> {
            // The first try may have deleted it before failing; the retry finds nothing.
            if (++tries[0] == 1) {
                reply(exchange, 502, Map.of("error", "bad gateway"));
                return;
            }
            reply(exchange, 404, Map.of("error", "no such branch"));
        });
        sky.index("x").at("old").deleteBranch();
        assertEquals(2, got.size());
        assertEquals("DELETE", got.get(1).method());
    }

    @Test
    void anErrorSaysWhatWasWrongAndWhere() throws IOException {
        Skywake sky = fake((seen, exchange) -> reply(exchange, 400, Map.of(
                "error", "must be a number",
                "code", "invalid",
                "request_id", "req-1",
                "path", "filter.price.lt")));
        SkywakeException e = assertThrows(SkywakeException.class, () -> sky.index("products").search(new Search("x")));
        assertEquals(List.of(400, "must be a number", "invalid", "req-1", "filter.price.lt"),
                List.of(e.status(), e.message(), e.code(), e.requestId(), e.path()));
        assertEquals("400: must be a number", e.getMessage());
        assertEquals(1, got.size(), "a 4xx is not retried");
    }

    @Test
    void rankAndMultiGiveTheirHitsAndBilling() throws IOException {
        List<Object> ranked = List.of(Map.of("id", 2, "score", 6, "attributes", Map.of()));
        Skywake sky = fake((seen, exchange) -> {
            if (seen.path().equals("/v1/indexes/docs/branches/main/rank")) {
                reply(exchange, 200, Map.of("hits", ranked, "billing", Map.of("queries", 1)));
                return;
            }
            List<Object> results = List.of(Map.of("rank", ranked), Map.of("aggregate", List.of()));
            reply(exchange, 200, Map.of("results", results, "billing", Map.of("queries", 2)));
        });
        Map<String, Object> score = Map.of("dot", Map.of("attribute", "terms", "indices", List.of(2), "values", List.of(3.0)));
        Results<Ranked> hits = sky.index("docs").rank(new Rank(score).topK(3));
        assertEquals(6, hits.items().get(0).score());
        assertEquals(1, hits.billing().queries());
        same(Map.of("score", score, "topK", 3), got.get(0).body());

        Results<MultiResult> results = sky.index("docs").multi(
                List.of(MultiRequest.of(new Rank(score)), MultiRequest.of(new Aggregate(Map.of("n", List.of("count"))))),
                "eventual");
        assertEquals(2, results.items().get(0).rank().get(0).id());
        assertEquals(2, results.billing().queries());
        same(Map.of(
                        "requests", List.of(
                                Map.of("rank", Map.of("score", score)),
                                Map.of("aggregate", Map.of("measures", Map.of("n", List.of("count"))))),
                        "consistency", "eventual"),
                got.get(1).body());
    }

    @Test
    void anExportIsReadOneDocumentAtATime() throws IOException {
        Skywake sky = fake((seen, exchange) ->
                send(exchange, 200, "{\"id\":1,\"vectors\":{\"v\":[1]}}\n\n{\"id\":\"b\",\"attributes\":{\"n\":2}}\n"));
        try (Stream<Document> docs = sky.index("x").export()) {
            assertEquals(List.of(1, "b"), docs.map(Document::id).collect(Collectors.toList()));
        }
        assertEquals("/v1/indexes/x/branches/main/export", got.get(0).path());
    }

    @Test
    void everyBranchIsReadAPageAtATime() throws IOException {
        List<Map<String, Object>> names = IntStream.range(0, 1001)
                .mapToObj(i -> Map.<String, Object>of("name", String.format("b%04d", i), "forked_from", "main", "created", ""))
                .collect(Collectors.toList());
        Skywake sky = fake((seen, exchange) ->
                reply(exchange, 200, seen.query().equals("limit=1000") ? names.subList(0, 1000) : names.subList(1000, 1001)));
        assertEquals(1001, sky.index("x").allBranches().count());
        assertEquals("limit=1000&after=b0999", got.get(1).query());
    }

    @Test
    void everyDocumentIsReadAPageAtATime() throws IOException {
        Skywake sky = fake((seen, exchange) -> {
            if (seen.query().equals("limit=1000")) {
                reply(exchange, 200, Map.of("documents", List.of(Map.of("id", 1)), "next", "c1"));
                return;
            }
            Map<String, Object> last = new HashMap<>();
            last.put("documents", List.of(Map.of("id", 2)));
            last.put("next", null);
            reply(exchange, 200, last);
        });
        assertEquals(List.of(1, 2), sky.index("x").allDocuments().map(Document::id).collect(Collectors.toList()));
        assertEquals("limit=1000&cursor=c1", got.get(1).query());
    }

    @Test
    void readsOfOneValueGoToTheirRoutes() throws IOException {
        Skywake sky = fake((seen, exchange) -> {
            switch (seen.path()) {
                case "/v1/indexes/x/branches/a%2Fb":
                    reply(exchange, 200, Map.of("name", "a/b", "stats", Map.of("rows", 7)));
                    break;
                case "/v1/indexes/x/branches/main/merge":
                    reply(exchange, 200, Map.of("rows", 2));
                    break;
                default:
                    reply(exchange, 202, Map.of("id", "op_1", "status", "running"));
            }
        });
        assertEquals(7, sky.index("x").at("a/b").stats().rows());
        assertEquals(2, sky.index("x").merge("a/b"));
        assertEquals("op_1", sky.index("x").build().id());
        same(Map.of("from", "a/b"), got.get(1).body());
    }

    @Test
    void anIndexIsMadeWithOnlyWhatIsGiven() throws IOException {
        Skywake sky = fake((seen, exchange) -> reply(exchange, 201, Map.of("name", "docs")));
        SearchIndex docs = sky.indexes().create(new NewIndex("docs",
                new Schema(List.of(new VectorColumn("embedding", 3)), List.of(new Attribute("title", "text")))));
        assertEquals("docs", docs.name());
        same(Map.of("name", "docs", "schema", Map.of(
                        "vectors", List.of(Map.of("name", "embedding", "dims", 3)),
                        "attributes", List.of(Map.of("name", "title", "type", "text")))),
                got.get(0).body());
        docs.copy(new CopyIndex("docs2").encryption(new Encryption("key-1")));
        same(Map.of("name", "docs2", "encryption", Map.of("kms_key_id", "key-1"), "branch", "main"), got.get(1).body());
        sky.indexes().update("docs", new UpdateIndex().readOnly(true));
        same(Map.of("read_only", true), got.get(2).body());
        sky.index("docs").hybrid(new Hybrid(Map.of("words", new Search("reset").topK(50))));
        same(Map.of("searches", Map.of("words", Map.of("query", "reset", "topK", 50)), "fuse", Map.of()), got.get(3).body());
    }

    @Test
    void anIndexIsPinnedUnpinnedAndSaysWhere() throws IOException {
        Map<String, Object> replica = Map.of("server", "api-1", "warm", true, "in_flight", 2);
        Skywake sky = fake((seen, exchange) -> reply(exchange, 200, Map.of(
                "name", "a", "pinned", Map.of("replicas", 1), "pinning", Map.of("replicas", List.of(replica)))));
        sky.indexes().create(new NewIndex("a", new Schema(List.of(), List.of())).pinned(2));
        same(Map.of("replicas", 2), got.get(0).body().get("pinned"));
        sky.indexes().update("a", new UpdateIndex().pinned(3));
        same(Map.of("pinned", Map.of("replicas", 3)), got.get(1).body());
        sky.indexes().update("a", new UpdateIndex().unpin());
        assertEquals("{\"pinned\":null}", got.get(2).body().toString());
        Index index = sky.indexes().get("a");
        assertEquals(new Pinned(1), index.pinned());
        assertEquals(new Pinning(List.of(new PinnedReplica("api-1", true, 2))), index.pinning());
    }

    @Test
    void anAttributeSendsItsTextOptionsAndFilterIndex() throws IOException {
        Skywake sky = fake((seen, exchange) -> reply(exchange, 201, Map.of()));
        sky.indexes().create(new NewIndex("docs", new Schema(List.of(), List.of(
                new Attribute("body", "text", null, null, "french", true, null),
                new Attribute("tag", "string").withFilterIndex()))));
        same(Map.of("name", "docs", "schema", Map.of("vectors", List.of(), "attributes", List.of(
                        Map.of("name", "body", "type", "text", "language", "french", "stopwords", true),
                        Map.of("name", "tag", "type", "string", "filter_index", true)))),
                got.get(0).body());
    }

    @Test
    void aWriteAsksForTheIdsItChangedAndAnIndexMayTakeUuids() throws IOException {
        Skywake sky = fake((seen, exchange) -> {
            if (seen.path().equals("/v1/indexes")) {
                reply(exchange, 201, Map.of("name", "b"));
                return;
            }
            reply(exchange, 200, Map.of("upserted", 0, "patched", 0, "deleted", 1, "deleted_ids", List.of("a")));
        });
        WriteCounts counts = sky.index("a").write(new Write().deletes(List.of("a")).returnAffectedIds());
        assertEquals(List.of("a"), counts.deletedIds());
        assertEquals(null, counts.upsertedIds());
        same(Map.of("deletes", List.of("a"), "returnAffectedIds", true), got.get(0).body());
        sky.indexes().create(new NewIndex("b", new Schema(List.of(new VectorColumn("v", 1)), List.of(), "uuid")));
        same(Map.of("name", "b", "schema", Map.of(
                        "vectors", List.of(Map.of("name", "v", "dims", 1)), "attributes", List.of(), "id", "uuid")),
                got.get(1).body());
    }

    @Test
    void versionsRestoreForkAtCollectAndParquetGoToTheirRoutes() throws IOException {
        String version = "a".repeat(64);
        Skywake sky = fake((seen, exchange) -> {
            if (seen.path().endsWith("/versions")) {
                reply(exchange, 200, List.of(Map.of("version", version, "time", "", "rows", 1)));
            } else if (seen.path().endsWith("/restore")) {
                reply(exchange, 200, Map.of("version", version, "time", "", "rows", 1));
            } else if (seen.path().endsWith("/collect")) {
                reply(exchange, 202, Map.of("id", "op_2", "kind", "collect", "status", "running"));
            } else if (seen.path().endsWith("/export")) {
                send(exchange, 200, "PAR1");
            } else {
                reply(exchange, 201, Map.of());
            }
        });
        SearchIndex main = sky.index("products");
        assertEquals(1, main.versions(5, version).get(0).rows());
        assertEquals(version, main.restore(version).version());
        assertEquals("past", main.fork("past", version).branch());
        Operation op = main.collect();
        assertEquals(List.of("op_2", "collect"), List.of(op.id(), op.kind()));
        try (var file = main.exportParquet()) {
            assertEquals("PAR1", new String(file.readAllBytes(), StandardCharsets.UTF_8));
        }
        sky.indexes().update("products", new UpdateIndex().retentionDays(7));
        sky.indexes().update("products", new UpdateIndex().keepAllVersions());
        List<String> routes = new ArrayList<>();
        for (Seen seen : got) {
            routes.add(seen.method() + " " + seen.path() + "?" + (seen.query() == null ? "" : seen.query()));
        }
        assertEquals(List.of(
                        "GET /v1/indexes/products/branches/main/versions?limit=5&after=" + version,
                        "POST /v1/indexes/products/branches/main/restore?",
                        "POST /v1/indexes/products/branches?",
                        "POST /v1/indexes/products/collect?",
                        "GET /v1/indexes/products/branches/main/export?format=parquet",
                        "PATCH /v1/indexes/products?",
                        "PATCH /v1/indexes/products?"),
                routes);
        same(Map.of("version", version), got.get(1).body());
        same(Map.of("name", "past", "from", "main", "at", version), got.get(2).body());
        same(Map.of("retention_days", 7), got.get(5).body());
        assertEquals("{\"retention_days\":null}", got.get(6).body().toString());
    }
}
