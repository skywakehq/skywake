package dev.skywake;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
    private static Disk app;

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
    void aFileWrittenToANewDiskReadsBackAndIsListed() {
        app = sky.createDisk("app", new DiskOptions().search(true));
        app.write("README.md", "# App\n");
        assertEquals("# App\n", app.read("README.md"));
        List<List<String>> listed = app.list().stream().map(entry -> List.of(entry.path(), entry.kind())).toList();
        assertEquals(List.of(List.of("README.md", "file")), listed);
    }

    @Test
    @Order(3)
    void manyFilesWrittenTogetherAreOneCommit() {
        int before = Pages.all(app.log()).size();
        Map<String, Object> files = new LinkedHashMap<>();
        files.put("src/a.ts", "export const a = 1;\n");
        files.put("src/b.ts", "export const b = 2;\n");
        files.put("notes.txt", "hi");
        app.write(files, new WriteOptions().message("three files"));
        List<Commit> log = Pages.all(app.log());
        assertEquals(before + 1, log.size());
        assertEquals("three files", log.get(0).message());
    }

    @Test
    @Order(4)
    void bothSidesChangingOneFileMakeTheMergeAMergeConflict() {
        Disk work = app.fork("agent-1");
        work.write("notes.txt", "from the agent");
        app.write("notes.txt", "from main");
        MergeConflictException error = assertThrows(MergeConflictException.class, () -> work.mergeInto("main"));
        assertEquals(List.of("notes.txt"), error.conflicts());
        DiskMerged settled = work.mergeInto("main", new MergeOptions().prefer(Prefer.THEIRS));
        assertNotNull(settled.commit());
        assertEquals("from the agent", app.read("notes.txt"));
    }

    @Test
    @Order(5)
    void grepFindAndQueryOnADiskFindAFile() throws InterruptedException {
        app.write("docs/coffee.md", "How to brew coffee at home.\n");
        List<Match> lines = app.grep("brew");
        assertEquals(List.of(List.of("docs/coffee.md", 1)),
                lines.stream().map(line -> List.<Object>of(line.path(), line.line())).toList());
        List<Found> found = app.find("*.md", new FindOptions().path("docs"));
        assertEquals(List.of("docs/coffee.md"), found.stream().map(Found::path).toList());
        List<FileHit> hits = new ArrayList<>();
        for (int tries = 0; tries <= 100; tries++) {
            hits = app.query("coffee");
            if (hits.stream().anyMatch(hit -> hit.path().equals("docs/coffee.md"))) {
                break;
            }
            Thread.sleep(200);
        }
        assertEquals("docs/coffee.md", hits.get(0).path());
    }

    @Test
    @Order(6)
    void readWithAtReturnsTheOldContentAfterAChange() {
        String old = app.head();
        app.write("README.md", "# App, changed\n");
        assertEquals("# App\n", app.read("README.md", new ReadOptions().at(old)));
        assertEquals("# App, changed\n", app.read("README.md"));
    }

    @Test
    @Order(7)
    void keysStayInTheirEnvironmentAndTheirRole() {
        Skywake staging = client(stagingKey).environment("prod").build();
        assertThrows(PermissionException.class, () -> staging.disk("app").read("README.md"));
        Skywake reader = client(readKey).build();
        assertEquals("# App, changed\n", reader.disk("app").read("README.md"));
        assertThrows(PermissionException.class, () -> reader.disk("app").write("x.txt", "nope"));
    }

    @Test
    @Order(8)
    void aWrongNameIsNotFoundWithASuggestion() {
        NotFoundException disk = assertThrows(NotFoundException.class, () -> sky.disk("ap").read("README.md"));
        assertTrue(String.valueOf(disk.hint()).contains("`app`"));
    }

    @Test
    @Order(9)
    void destroyingABranchThenTheDiskEmptiesTheList() {
        app.on("agent-1").destroy();
        assertEquals(List.of("main"), app.branches().stream().map(Branch::name).toList());
        app.destroy();
        assertEquals(List.of(), Pages.all(sky.listDisks()));
    }

    @Test
    @Order(10)
    void aFolderGoesUpAsOneCommitAndComesBackTheSame() throws Exception {
        Path dir = Files.createTempDirectory("skywake-up-");
        Files.writeString(dir.resolve("a.txt"), "alpha");
        Files.write(dir.resolve("b.bin"), new byte[] {0, 1, 2, (byte) 255});
        Disk site = sky.disk("site");
        site.upload(dir, "site");
        Path back = Files.createTempDirectory("skywake-down-");
        site.download(back);
        assertEquals("alpha", Files.readString(back.resolve("a.txt")));
        assertArrayEquals(new byte[] {0, 1, 2, (byte) 255}, Files.readAllBytes(back.resolve("b.bin")));
        site.destroy();
    }
}
