import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";

import {
  collect,
  MergeConflict,
  NotFound,
  PermissionError,
  Skywake,
  type Disk,
  type Index,
} from "../dist/index.js";

const URL = process.env.SKYWAKE_SCENARIO_URL;
const ADMIN = process.env.SKYWAKE_SCENARIO_KEY;
const skip = URL && ADMIN ? false : "needs SKYWAKE_SCENARIO_URL and SKYWAKE_SCENARIO_KEY";

const keys = { prod: "", staging: "", read: "" };
let sky: Skywake;

before(async () => {
  if (skip) return;
  const org = new Skywake({ url: URL, key: ADMIN });
  await org.createEnvironment("prod");
  await org.createEnvironment("staging");
  const made = (name: string, role: "admin" | "read", environment: string) =>
    org.createKey({ name, role, environment }).then((created) => created.key);
  keys.prod = await made("prod", "admin", "prod");
  keys.staging = await made("staging", "admin", "staging");
  keys.read = await made("reader", "read", "prod");
  for (const name of ["SKYWAKE_KEY", "SKYWAKE_ENV", "SKYWAKE_PROFILE"]) delete process.env[name];
  process.env.SKYWAKE_URL = URL;
  process.env.SKYWAKE_API_KEY = keys.prod;
  sky = new Skywake();
});

async function eventually<T>(check: () => Promise<T | undefined>): Promise<T> {
  for (let tries = 0; ; tries++) {
    const found = await check();
    if (found !== undefined || tries === 100) return found as T;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const names = async (items: AsyncIterable<{ name: string }>) =>
  (await collect(items)).map((item) => item.name);

test("1. with only SKYWAKE_API_KEY set, whoami shows the environment", { skip }, async () => {
  const me = await sky.whoami();
  assert.equal(me.environment, "prod");
  assert.equal(me.role, "admin");
});

let products: Index;

test("2. one row upserted to a new index with no schema is found by query", { skip }, async () => {
  products = sky.index("products");
  await products.upsert({ id: "mug", text: "a blue coffee mug", price: 12, tags: ["kitchen"] });
  const hits = await products.query("coffee mug");
  assert.equal(hits[0]?.id, "mug");
  assert.equal(hits[0]?.price, 12);
  assert.ok(hits[0]!.score > 0);
});

test("3. 10,000 rows upserted in one call are all counted", { skip }, async () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => ({
    id: `row-${i}`,
    text: i % 2 ? `running shoe number ${i}` : `invoice ${i}`,
    price: i % 100,
    tags: [i % 2 ? "shoes" : "billing"],
  }));
  const done = await sky.index("bulk").upsert(rows);
  assert.equal(done.count, 10_000);
  assert.equal(await sky.index("bulk").count(), 10_000);
  assert.equal(await sky.index("bulk").count({ filter: { tags: { contains: "shoes" } } }), 5_000);
});

test("4. a query takes a filter, a limit and keywords mode", { skip }, async () => {
  const hits = await sky.index("bulk").query("shoe", {
    mode: "keywords",
    filter: { price: { lt: 10 } },
    limit: 3,
  });
  assert.equal(hits.length, 3);
  for (const hit of hits) {
    assert.ok(hit.price < 10);
    assert.match(hit.text, /shoe/);
  }
});

test("5. update shows in get; delete makes get null", { skip }, async () => {
  assert.equal(await products.update("mug", { price: 9 }), 1);
  assert.equal((await products.get("mug"))?.price, 9);
  assert.equal(await products.delete("mug"), 1);
  assert.equal(await products.get("mug"), null);
});

test("6. a fork changes apart from main, and merging brings the change", { skip }, async () => {
  await products.upsert({ id: "cup", text: "a white coffee cup", price: 5 });
  const draft = await products.fork("draft");
  await draft.update("cup", { price: 7 });
  assert.equal((await draft.query("coffee cup"))[0]?.price, 7);
  assert.equal((await products.query("coffee cup"))[0]?.price, 5);
  await draft.mergeInto("main");
  assert.equal((await products.get("cup"))?.price, 7);
});

let app: Disk;

test("7. a file written to a new disk reads back and is listed", { skip }, async () => {
  app = sky.disk("app");
  await app.write("README.md", "# App\n");
  assert.equal(await app.read("README.md"), "# App\n");
  const listed = await app.list();
  assert.deepEqual(
    listed.map((entry) => [entry.path, entry.kind]),
    [["README.md", "file"]],
  );
});

test("8. many files written together are one commit", { skip }, async () => {
  const before = (await collect(app.log())).length;
  await app.write(
    { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n", "notes.txt": "hi" },
    { message: "three files" },
  );
  const log = await collect(app.log());
  assert.equal(log.length, before + 1);
  assert.equal(log[0]!.message, "three files");
});

test("9. both sides changing one file make the merge a MergeConflict", { skip }, async () => {
  const work = await app.fork("agent-1");
  await work.write("notes.txt", "from the agent");
  await app.write("notes.txt", "from main");
  await assert.rejects(work.mergeInto("main"), (error: MergeConflict) => {
    assert.ok(error instanceof MergeConflict);
    assert.deepEqual(error.conflicts, ["notes.txt"]);
    return true;
  });
  const settled = await work.mergeInto("main", { prefer: "theirs" });
  assert.ok(settled.commit);
  assert.equal(await app.read("notes.txt"), "from the agent");
});

test("10. grep, find and query on a disk find a file", { skip }, async () => {
  await app.write("docs/coffee.md", "How to brew coffee at home.\n");
  const lines = await app.grep("brew");
  assert.deepEqual(
    lines.map((line) => [line.path, line.line]),
    [["docs/coffee.md", 1]],
  );
  const found = await app.find("*.md", { path: "docs" });
  assert.deepEqual(
    found.map((entry) => entry.path),
    ["docs/coffee.md"],
  );
  const synced = async () => {
    const hits = await app.query("coffee");
    return hits.some((hit) => hit.path === "docs/coffee.md") ? hits : undefined;
  };
  const hits = await eventually(synced);
  assert.equal(hits[0]?.path, "docs/coffee.md");
});

test("11. read with at returns the old content after a change", { skip }, async () => {
  const old = await app.head();
  await app.write("README.md", "# App, changed\n");
  assert.equal(await app.read("README.md", { at: old! }), "# App\n");
  assert.equal(await app.read("README.md"), "# App, changed\n");
});

test("12. keys stay in their environment and their role", { skip }, async () => {
  const staging = new Skywake({ key: keys.staging, environment: "prod" });
  await assert.rejects(staging.index("products").query("coffee"), PermissionError);
  const reader = new Skywake({ key: keys.read });
  assert.equal((await reader.index("products").get("cup"))?.price, 7);
  await assert.rejects(reader.index("products").upsert({ id: "x", text: "nope" }), PermissionError);
});

test("13. a wrong name is NotFound with a suggestion", { skip }, async () => {
  await assert.rejects(sky.index("prodcts").query("coffee"), (error: NotFound) => {
    assert.ok(error instanceof NotFound);
    assert.match(error.hint ?? "", /products/);
    return true;
  });
  await assert.rejects(sky.disk("ap").read("README.md"), (error: NotFound) => {
    assert.ok(error instanceof NotFound);
    assert.match(error.hint ?? "", /`app`/);
    return true;
  });
});

test(
  "14. destroying a branch, then the index and the disk, empties the lists",
  { skip },
  async () => {
    await products.on("draft").destroy();
    assert.deepEqual(
      (await products.branches()).map((branch) => branch.name),
      ["main"],
    );
    await app.on("agent-1").destroy();
    for (const name of ["products", "bulk"]) await sky.index(name).destroy();
    await app.destroy();
    assert.deepEqual(await names(sky.listIndexes()), []);
    assert.deepEqual(await names(sky.listDisks()), []);
  },
);

test("a folder goes up as one commit and comes back the same", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "skywake-up-"));
  writeFileSync(join(dir, "a.txt"), "alpha");
  writeFileSync(join(dir, "b.bin"), new Uint8Array([0, 1, 2, 255]));
  const site = sky.disk("site");
  await site.upload(dir, { message: "site" });
  const back = mkdtempSync(join(tmpdir(), "skywake-down-"));
  await site.download(back);
  assert.equal(readFileSync(join(back, "a.txt"), "utf8"), "alpha");
  assert.deepEqual([...readFileSync(join(back, "b.bin"))], [0, 1, 2, 255]);
  await site.destroy();
});
