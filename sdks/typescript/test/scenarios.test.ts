import assert from "node:assert/strict";
import { before, test } from "node:test";

import {
  collect,
  Conflict,
  NotFound,
  PermissionError,
  Skywake,
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
  for (const name of ["prod", "staging"]) {
    await org.createEnvironment(name).catch((error) => {
      if (!(error instanceof Conflict)) throw error;
    });
  }
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

test("7. keys stay in their environment and their role", { skip }, async () => {
  const staging = new Skywake({ key: keys.staging, environment: "prod" });
  await assert.rejects(staging.index("products").query("coffee"), PermissionError);
  const reader = new Skywake({ key: keys.read });
  assert.equal((await reader.index("products").get("cup"))?.price, 7);
  await assert.rejects(reader.index("products").upsert({ id: "x", text: "nope" }), PermissionError);
});

test("8. a wrong name is NotFound with a suggestion", { skip }, async () => {
  await assert.rejects(sky.index("prodcts").query("coffee"), (error: NotFound) => {
    assert.ok(error instanceof NotFound);
    assert.match(error.hint ?? "", /products/);
    return true;
  });
});

test("9. destroying a branch, then the indexes, empties the lists", { skip }, async () => {
  await products.on("draft").destroy();
  assert.deepEqual(
    (await products.branches()).map((branch) => branch.name),
    ["main"],
  );
  for (const name of ["products", "bulk"]) await sky.index(name).destroy();
  assert.deepEqual(await names(sky.listIndexes()), []);
});
