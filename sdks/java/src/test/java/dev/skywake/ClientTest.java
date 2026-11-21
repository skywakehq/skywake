package dev.skywake;

import static dev.skywake.FakeApi.Reply.failure;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import dev.skywake.FakeApi.Reply;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ClientTest {
    private static void same(Object want, JsonNode got) {
        assertEquals(Json.MAPPER.valueToTree(want), got);
    }

    @Test
    void requestsGoToV2WithTheKeyAndTheEnvironment() throws Exception {
        Reply me = Reply.json(Map.of("organization", "acme", "environment", "prod"));
        try (FakeApi api = new FakeApi((seen, count) -> me)) {
            assertEquals("prod", api.builder().environment("prod").build().whoami().environment());
            assertEquals("/v2/whoami", api.at(0).path());
            assertEquals("Bearer k", api.at(0).headers().getFirst("authorization"));
            assertEquals("prod", api.at(0).headers().getFirst("skywake-environment"));
        }
    }

    @Test
    void eachStatusBecomesItsOwnErrorWithTheHintInTheMessage() throws Exception {
        List<Reply> replies = List.of(
                failure(401, "unauthorized"),
                failure(403, "forbidden"),
                failure(404, "not_found", Map.of("hint", "did you mean `products`?")),
                failure(500, "internal"));
        try (FakeApi api = new FakeApi((seen, count) -> replies.get(Math.min(count, 4) - 1))) {
            Skywake sky = api.builder().retries(0).build();
            assertThrows(AuthException.class, sky::whoami);
            assertThrows(PermissionException.class, sky::whoami);
            NotFoundException missing = assertThrows(NotFoundException.class, () -> sky.disk("prodcts").info());
            assertEquals("did you mean `products`?", missing.hint());
            assertTrue(missing.getMessage().contains("did you mean `products`?"));
            assertEquals("req-1", missing.requestId());
            assertEquals(404, missing.status());
            assertThrows(ServerException.class, sky::whoami);
        }
    }

    @Test
    void a429IsRetriedAsTheServerAsksThenReportedWithRetryAfter() throws Exception {
        try (FakeApi api = new FakeApi((seen, count) -> failure(429, "rate_limited").withHeader("retry-after", "1"))) {
            RateLimitedException error = assertThrows(
                    RateLimitedException.class, () -> api.builder().retries(1).build().whoami());
            assertEquals(Duration.ofSeconds(1), error.retryAfter());
            assertEquals(2, api.seen.size());
        }
    }

    @Test
    void aGetIsRetriedAfterA5xxButAPostIsNot() throws Exception {
        try (FakeApi api = new FakeApi((seen, count) -> failure(503, "unavailable"))) {
            Skywake sky = api.builder().retries(2).build();
            assertThrows(ServerException.class, sky::whoami);
            assertEquals(3, api.seen.size());
            assertThrows(ServerException.class, () -> sky.disk("app").query("coffee"));
            assertEquals(4, api.seen.size());
        }
    }

    @Test
    void aMergeThatCantFinishIsAMergeConflictListingWhatConflicts() throws Exception {
        try (FakeApi api = new FakeApi((seen, count) ->
                failure(409, "conflict", Map.of("conflicts", List.of("README.md"))))) {
            Disk work = api.sky().disk("app", "agent-1");
            MergeConflictException error = assertThrows(MergeConflictException.class, work::mergeInto);
            assertEquals(List.of("README.md"), error.conflicts());
            assertTrue(error instanceof ConflictException);
            same(Map.of("from", "agent-1", "into", "main"), api.at(0).json());
        }
    }

    @Test
    void listsFollowNextUntilTheLastPage() throws Exception {
        try (FakeApi api = new FakeApi((seen, count) -> "b".equals(seen.query().get("cursor"))
                ? Reply.json(page(List.of(Map.of("name", "c")), null))
                : Reply.json(page(List.of(Map.of("name", "a"), Map.of("name", "b")), "b")))) {
            List<String> names = new ArrayList<>();
            for (DiskSummary disk : api.sky().listDisks()) {
                names.add(disk.name());
            }
            assertEquals(List.of("a", "b", "c"), names);
        }
    }

    @Test
    void queryOnADiskSendsTheTextOptionsAndBranch() throws Exception {
        try (FakeApi api = new FakeApi((seen, count) -> Reply.json(page(
                List.of(Map.of("path", "docs/coffee.md", "score", 0.9, "snippet", "brew coffee")), null)))) {
            List<FileHit> hits = api.sky().disk("app", "draft")
                    .query("coffee", new FileQueryOptions().limit(3).path("docs"));
            assertEquals("docs/coffee.md", hits.get(0).path());
            assertEquals("/v2/disks/app/query", api.at(0).path());
            same(Map.of("text", "coffee", "limit", 3, "path", "docs", "branch", "draft"), api.at(0).json());
        }
    }

    @Test
    void filesAreReadAndWrittenByPathEachPartOfItEncoded() throws Exception {
        try (FakeApi api = new FakeApi((seen, count) -> seen.method().equals("GET")
                ? Reply.raw("hello".getBytes())
                : Reply.json(Map.of("commit", "c1", "changed", true)))) {
            Disk app = api.sky().disk("app");
            assertEquals("hello", app.read("/docs/a b.md", new ReadOptions().at("c0")));
            assertArrayEquals("hello".getBytes(), app.readBytes("x"));
            Map<String, Object> files = new LinkedHashMap<>();
            files.put("a.md", "one");
            files.put("b.bin", new byte[] {(byte) 0xff, 0x00});
            app.write(files, new WriteOptions().message("two"));
            assertEquals("/v2/disks/app/files/docs/a%20b.md", api.at(0).path());
            assertEquals("c0", api.at(0).query().get("at"));
            same(Map.of(
                            "message", "two",
                            "branch", "main",
                            "changes", List.of(
                                    Map.of("path", "a.md", "text", "one"),
                                    Map.of("path", "b.bin", "base64", "/wA="))),
                    api.at(2).json());
        }
    }

    @Test
    void aLargeFileGoesUpInPartsBeforeItsCommit() throws Exception {
        try (FakeApi api = new FakeApi((seen, count) -> seen.path().endsWith("/uploads")
                ? Reply.status(201, Map.of("part", "p" + seen.body().length, "size", seen.body().length))
                : Reply.json(Map.of("commit", "c1", "changed", true)))) {
            api.sky().disk("app").write("big.bin", new byte[20 * 1024 * 1024]);
            List<Integer> parts = api.seen.stream()
                    .filter(seen -> seen.path().endsWith("/uploads"))
                    .map(seen -> seen.body().length)
                    .toList();
            assertEquals(List.of(16 * 1024 * 1024, 4 * 1024 * 1024), parts);
            JsonNode commit = api.at(api.seen.size() - 1).json();
            same(List.of(Map.of("path", "big.bin", "parts", List.of("p" + 16 * 1024 * 1024, "p" + 4 * 1024 * 1024))),
                    commit.path("changes"));
        }
    }

    @Test
    void aForkIsAHandleOnTheNewBranchAndDestroyRemovesJustTheBranch() throws Exception {
        try (FakeApi api = new FakeApi((seen, count) -> seen.method().equals("DELETE")
                ? Reply.status(204, null)
                : Reply.status(201, Map.of("name", "agent-1")))) {
            Disk work = api.sky().disk("app").fork("agent-1", "c3");
            assertEquals("agent-1", work.branch());
            work.destroy();
            same(Map.of("name", "agent-1", "from", "main", "at", "c3"), api.at(0).json());
            assertEquals("DELETE", api.at(1).method());
            assertEquals("/v2/disks/app/branches/agent-1", api.at(1).path());
        }
    }

    @Test
    void restoreToATimePicksTheNewestCommitAtOrBeforeIt() throws Exception {
        try (FakeApi api = new FakeApi((seen, count) -> seen.method().equals("GET")
                ? Reply.json(page(List.of(
                        commit("c3", "2026-01-03T00:00:00Z"), commit("c2", "2026-01-02T00:00:00Z")), null))
                : Reply.json(Map.of("commit", "c4", "changed", true)))) {
            api.sky().disk("app").restore(Instant.parse("2026-01-02T12:00:00Z"));
            same(Map.of("to", "c2", "branch", "main"), api.at(1).json());
        }
    }

    private static Map<String, Object> page(List<?> data, String next) {
        Map<String, Object> page = new LinkedHashMap<>();
        page.put("data", data);
        page.put("next", next);
        return page;
    }

    private static Map<String, Object> commit(String id, String created) {
        Map<String, Object> commit = new LinkedHashMap<>();
        commit.put("id", id);
        commit.put("message", "");
        commit.put("created", created);
        commit.put("merged", null);
        return commit;
    }
}
