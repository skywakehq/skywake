package dev.skywake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

@TestMethodOrder(OrderAnnotation.class)
class ScenarioTest {
    private static final String URL = System.getenv("SKYWAKE_SCENARIO_URL");
    private static final String ADMIN = System.getenv("SKYWAKE_SCENARIO_KEY");

    private static String stagingKey;
    private static String readKey;
    private static Skywake sky;
    private static Index products;

    @BeforeAll
    static void setUp() {
        assumeTrue(URL != null && ADMIN != null, "needs SKYWAKE_SCENARIO_URL and SKYWAKE_SCENARIO_KEY");
        Skywake org = Skywake.builder().url(URL).key(ADMIN).build();
        for (String name : List.of("prod", "staging")) {
            try {
                org.createEnvironment(name);
            } catch (ConflictException taken) {
                assertEquals(409, taken.status());
            }
        }
        String prodKey = org.createKey(new NewKey("prod", Role.ADMIN).environment("prod")).key();
        stagingKey = org.createKey(new NewKey("staging", Role.ADMIN).environment("staging")).key();
        readKey = org.createKey(new NewKey("reader", Role.READ).environment("prod")).key();
        Map<String, String> env = Map.of("SKYWAKE_URL", URL, "SKYWAKE_API_KEY", prodKey);
        sky = Skywake.builder().env(env::get).build();
    }

    private static Skywake.Builder client(String key) {
        return Skywake.builder().url(URL).key(key).env(name -> null);
    }

    @Test
    @Order(1)
    void withOnlyTheApiKeySetWhoamiShowsTheEnvironment() {
        Whoami me = sky.whoami();
        assertEquals("prod", me.environment());
        assertEquals(Role.ADMIN, me.role());
    }

    @Test
    @Order(2)
    void oneRowUpsertedToANewIndexWithNoSchemaIsFoundByQuery() {
        products = sky.index("products");
        products.upsert(Map.of("id", "mug", "text", "a blue coffee mug", "price", 12, "tags", List.of("kitchen")));
        List<Map<String, Object>> hits = products.query("coffee mug");
        assertEquals("mug", hits.get(0).get("id"));
        assertEquals(12, ((Number) hits.get(0).get("price")).intValue());
        assertTrue(((Number) hits.get(0).get("score")).doubleValue() > 0);
    }

    @Test
    @Order(3)
    void tenThousandRowsUpsertedInOneCallAreAllCounted() {
        List<Map<String, Object>> rows = IntStream.range(0, 10_000)
                .mapToObj(i -> Map.<String, Object>of(
                        "id", "row-" + i,
                        "text", i % 2 == 1 ? "running shoe number " + i : "invoice " + i,
                        "price", i % 100,
                        "tags", List.of(i % 2 == 1 ? "shoes" : "billing")))
                .toList();
        Upserted done = sky.index("bulk").upsert(rows);
        assertEquals(10_000, done.count());
        assertEquals(10_000, sky.index("bulk").count());
        assertEquals(5_000, sky.index("bulk").count(Map.of("tags", Map.of("contains", "shoes"))));
    }

    @Test
    @Order(4)
    void aQueryTakesAFilterALimitAndKeywordsMode() {
        List<Map<String, Object>> hits = sky.index("bulk").query("shoe", new QueryOptions()
                .mode(Mode.KEYWORDS)
                .filter(Map.of("price", Map.of("lt", 10)))
                .limit(3));
        assertEquals(3, hits.size());
        for (Map<String, Object> hit : hits) {
            assertTrue(((Number) hit.get("price")).intValue() < 10);
            assertTrue(((String) hit.get("text")).contains("shoe"));
        }
    }

    @Test
    @Order(5)
    void updateShowsInGetAndDeleteMakesGetNull() {
        assertEquals(1, products.update("mug", Map.of("price", 9)));
        assertEquals(9, ((Number) products.get("mug").get("price")).intValue());
        assertEquals(1, products.delete("mug"));
        assertNull(products.get("mug"));
    }

    @Test
    @Order(6)
    void aForkChangesApartFromMainAndMergingBringsTheChange() {
        products.upsert(Map.of("id", "cup", "text", "a white coffee cup", "price", 5));
        Index draft = products.fork("draft");
        draft.update("cup", Map.of("price", 7));
        assertEquals(7, price(draft.query("coffee cup").get(0)));
        assertEquals(5, price(products.query("coffee cup").get(0)));
        draft.mergeInto("main");
        assertEquals(7, price(products.get("cup")));
    }

    @Test
    @Order(7)
    void keysStayInTheirEnvironmentAndTheirRole() {
        Skywake staging = client(stagingKey).environment("prod").build();
        assertThrows(PermissionException.class, () -> staging.index("products").query("coffee"));
        Skywake reader = client(readKey).build();
        assertEquals(7, price(reader.index("products").get("cup")));
        assertThrows(PermissionException.class,
                () -> reader.index("products").upsert(Map.of("id", "x", "text", "nope")));
    }

    @Test
    @Order(8)
    void aWrongNameIsNotFoundWithASuggestion() {
        NotFoundException index = assertThrows(NotFoundException.class, () -> sky.index("prodcts").query("coffee"));
        assertTrue(String.valueOf(index.hint()).contains("products"));
    }

    @Test
    @Order(9)
    void destroyingABranchThenTheIndexesEmptiesTheList() {
        products.on("draft").destroy();
        assertEquals(List.of("main"), products.branches().stream().map(Branch::name).toList());
        for (String name : List.of("products", "bulk")) {
            sky.index(name).destroy();
        }
        assertEquals(List.of(), Pages.all(sky.listIndexes()));
    }

    private static int price(Map<String, Object> row) {
        return ((Number) row.get("price")).intValue();
    }
}
