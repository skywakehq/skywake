import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Index, type EngineError, type IndexFilter, type IndexSchema } from "../index.js";

const SCHEMA: IndexSchema = {
  vectors: [{ name: "v", dims: 2, metric: "euclidean" }],
  // In name order, as `schema` gives them back.
  attributes: [
    { name: "price", type: "number" },
    { name: "tag", type: "string" },
  ],
};

const kind = (expected: string) => (error: EngineError) => error.kind === expected;

async function made() {
  const folder = mkdtempSync(join(tmpdir(), "skywake-index-"));
  const index = Index.open(folder);
  await index.create(SCHEMA);
  return { folder, index };
}

test("an index writes, queries with filters, builds and deletes", async () => {
  const { index } = await made();
  assert.deepEqual(await index.schema("main"), SCHEMA);
  await index.upsert("main", [
    { id: 1, vectors: { v: [0, 0] }, attributes: { tag: "a", price: 5 } },
    { id: "two", vectors: { v: [1, 0] }, attributes: { tag: "b", price: 20 } },
    { id: 3, vectors: { v: [2, 0] }, attributes: { tag: "a", price: 30 } },
  ]);
  const near = await index.query("main", { column: "v", vector: [0, 0], topK: 2 });
  assert.deepEqual(
    near.map((hit) => [hit.id, hit.distance]),
    [
      [1, 0],
      ["two", 1],
    ],
  );

  const filtered = await index.query("main", {
    column: "v",
    vector: [0, 0],
    topK: 5,
    filter: { and: [{ tag: { eq: "a" } }, { price: { gt: 10 } }] },
    include: ["price"],
  });
  assert.deepEqual(filtered, [{ id: 3, distance: 4, attributes: { price: 30 } }]);
  const none = await index.query("main", {
    column: "v",
    vector: [0, 0],
    topK: 5,
    filter: { not: { tag: { in: ["a", "b"] } } },
  });
  assert.deepEqual(none, []);

  const stats = await index.stats("main");
  assert.equal(stats.rows, 3);
  assert.equal(stats.unindexedRows, 3);

  await index.build("main");
  await index.delete("main", [1]);
  const after = await index.query("main", { column: "v", vector: [0, 0], topK: 5, probe: 100 });
  assert.deepEqual(
    after.map((hit) => hit.id),
    ["two", 3],
  );
});

test("branches fork, see only their own writes, and are deleted", async () => {
  const { index } = await made();
  await index.upsert("main", [{ id: 1, vectors: { v: [0, 0] } }]);
  await index.fork("main", "agents/try");
  await index.upsert("agents/try", [{ id: 2, vectors: { v: [1, 1] } }]);
  const ids = async (branch: string) =>
    (await index.query(branch, { column: "v", vector: [0, 0], topK: 10 })).map((hit) => hit.id);
  assert.deepEqual(await ids("main"), [1]);
  assert.deepEqual(await ids("agents/try"), [1, 2]);
  assert.deepEqual(await index.branches(), ["agents/try", "main"]);

  await assert.rejects(index.fork("main", "agents/try"), kind("conflict"));
  await index.deleteBranch("agents/try");
  assert.deepEqual(await index.branches(), ["main"]);
  await assert.rejects(ids("agents/try"), kind("not_found"));
  await assert.rejects(index.deleteBranch("agents/try"), kind("not_found"));
});

test("bad input is refused with `invalid`", async () => {
  const { index } = await made();
  await assert.rejects(index.create(SCHEMA), kind("conflict"));
  await assert.rejects(
    index.upsert("main", [{ id: 1, vectors: { v: [0, 0, 0] } }]),
    kind("invalid"),
  );
  await assert.rejects(
    index.upsert("main", [{ id: 1.5, vectors: { v: [0, 0] } }]),
    kind("invalid"),
  );
  await assert.rejects(
    index.upsert("main", [{ id: 1, vectors: { v: [0, 0] }, attributes: { price: "x" } }]),
    kind("invalid"),
  );
  const query = { column: "v", vector: [0, 0], topK: 1 };
  await assert.rejects(index.query("main", { ...query, column: "w" }), kind("invalid"));
  await assert.rejects(
    index.query("main", { ...query, filter: { price: { near: 1 } as {} } }),
    kind("invalid"),
  );
  await assert.rejects(index.fork("main", "../x"), kind("invalid"));
  await assert.rejects(index.query("nope", query), kind("not_found"));
  await assert.rejects(
    Index.open(mkdtempSync(join(tmpdir(), "skywake-index-"))).create({
      vectors: [{ name: "v", dims: 2, metric: "manhattan" as "dot" }],
      attributes: [],
    }),
    kind("invalid"),
  );
});

test("destroy deletes everything in the folder", async () => {
  const { folder, index } = await made();
  await index.upsert("main", [{ id: 1, vectors: { v: [0, 0] } }]);
  await index.destroy();
  const left = readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  );
  assert.deepEqual(left, []);
  await assert.rejects(index.schema("main"), kind("not_found"));
});

test("documents are read back a page at a time, and by id", async () => {
  const { index } = await made();
  await index.upsert("main", [
    { id: "b", vectors: { v: [1, 0] }, attributes: { tag: "x" } },
    { id: 2, vectors: { v: [2, 0] } },
    { id: 1, vectors: { v: [0, 1] }, attributes: { price: 3 } },
  ]);
  await index.delete("main", [2]);
  const first = await index.scan("main", null, 1);
  assert.deepEqual(first, [{ id: 1, vectors: { v: [0, 1] }, attributes: { price: 3 } }]);
  const rest = await index.scan("main", 1, 10);
  assert.deepEqual(
    rest.map((doc) => doc.id),
    ["b"],
  );
  assert.equal((await index.get("main", "b"))?.attributes?.tag, "x");
  assert.equal(await index.get("main", 2), null);
  await assert.rejects(index.scan("nope", null, 1), kind("not_found"));
});

test("text attributes search by BM25, filter by phrase, and fuse with vectors", async () => {
  const folder = mkdtempSync(join(tmpdir(), "skywake-index-"));
  const index = Index.open(folder);
  const schema: IndexSchema = {
    vectors: [{ name: "v", dims: 2, metric: "euclidean" }],
    attributes: [
      { name: "body", type: "text", k1: 0.9, b: 0.4 },
      { name: "fr", type: "text", language: "french", stopwords: true },
      { name: "tag", type: "string" },
    ],
  };
  await index.create(schema);
  assert.deepEqual(await index.schema("main"), {
    ...schema,
    attributes: [
      { name: "body", type: "text", k1: 0.9, b: 0.4, language: "english", stopwords: false },
      { name: "fr", type: "text", k1: 1.2, b: 0.75, language: "french", stopwords: true },
      { name: "tag", type: "string" },
    ],
  });
  await index.upsert("main", [
    {
      id: 1,
      vectors: { v: [0, 0] },
      attributes: { body: "reset your password", fr: "les chevaux", tag: "a" },
    },
    { id: 2, vectors: { v: [1, 0] }, attributes: { body: "password rules and reset", tag: "b" } },
    { id: 3, vectors: { v: [2, 0] }, attributes: { body: "billing questions", tag: "a" } },
  ]);
  for (const round of ["tail", "built"]) {
    const hits = await index.search("main", {
      query: "reset password",
      topK: 5,
      highlight: ["body"],
    });
    assert.deepEqual(hits.map((hit) => hit.id).sort(), [1, 2], round);
    assert.ok(hits[0]!.score > 0);
    assert.deepEqual(hits.find((hit) => hit.id === 1)!.highlights.body, {
      text: "reset your password",
      marks: [
        [0, 5],
        [11, 19],
      ],
    });
    const phrase = await index.search("main", {
      query: "password",
      topK: 5,
      filter: { and: [{ body: { phrase: "reset your" } }, { tag: { eq: "a" } }] },
    });
    assert.deepEqual(
      phrase.map((hit) => hit.id),
      [1],
      round,
    );
    const prefix = await index.search("main", {
      query: "password",
      topK: 5,
      filter: { body: { prefix: "rules an" } },
    });
    assert.deepEqual(
      prefix.map((hit) => hit.id),
      [2],
      round,
    );
    const all = await index.search("main", {
      query: "password",
      topK: 5,
      filter: { body: { contains_all_tokens: "Resets rules" } },
    });
    assert.deepEqual(
      all.map((hit) => hit.id),
      [2],
      round,
    );
    const any = await index.search("main", {
      query: "password",
      topK: 5,
      filter: { and: [{ body: { contains_any_token: "your rules" } }, { tag: { eq: "a" } }] },
    });
    assert.deepEqual(
      any.map((hit) => hit.id),
      [1],
      round,
    );
    const french = await index.search("main", { query: "le cheval", fields: ["fr"], topK: 5 });
    assert.deepEqual(
      french.map((hit) => hit.id),
      [1],
      round,
    );
    const fused = await index.hybrid("main", {
      searches: [
        { name: "near", vector: { column: "v", vector: [2, 0], topK: 3 } },
        { name: "words", text: { query: "billing", topK: 3 } },
      ],
      topK: 2,
    });
    assert.equal(fused[0]!.id, 3, round);
    assert.deepEqual(fused[0]!.ranks, { near: 1, words: 1 });
    // Nearest to [0, 0] first: a distance that halves the score every 1.
    const decayed = await index.hybrid("main", {
      searches: [{ name: "near", vector: { column: "v", vector: [0, 0], topK: 3 } }],
      topK: 3,
      rank: { decay: { of: { search: "near" }, origin: 0, scale: 1 } },
    });
    assert.deepEqual(
      decayed.map((hit) => [hit.id, hit.score]),
      [
        [1, 1],
        [2, 0.5],
        [3, 0.0625],
      ],
      round,
    );
    await index.build("main");
  }
  await assert.rejects(
    index.search("main", { query: "x", topK: 1, filter: { or: [{ body: { phrase: "x" } }] } }),
    kind("invalid"),
  );
});

test("attributes are added to a branch online, and old documents lack them", async () => {
  const { index } = await made();
  await index.upsert("main", [{ id: 1, vectors: { v: [0, 0] }, attributes: { tag: "a" } }]);
  await index.build("main");
  await index.warm("main");
  const altered = await index.alter("main", {
    vectors: [],
    attributes: [{ name: "lang", type: "string" }],
  });
  assert.deepEqual(
    altered.attributes.map((c) => c.name),
    ["lang", "price", "tag"],
  );
  await index.upsert("main", [
    { id: 2, vectors: { v: [1, 0] }, attributes: { tag: "a", lang: "en" } },
  ]);
  const english = await index.query("main", {
    column: "v",
    vector: [0, 0],
    topK: 5,
    filter: { lang: { eq: "en" } },
  });
  assert.deepEqual(
    english.map((hit) => hit.id),
    [2],
  );
  const retyped = { vectors: [], attributes: [{ name: "lang", type: "int" as const }] };
  await assert.rejects(index.alter("main", retyped), kind("invalid"));
});

test("a filter index is declared, read back and turned on online", async () => {
  const folder = mkdtempSync(join(tmpdir(), "skywake-index-"));
  const index = Index.open(folder);
  const schema: IndexSchema = {
    vectors: [{ name: "v", dims: 2, metric: "euclidean" }],
    attributes: [
      { name: "price", type: "number" },
      { name: "tag", type: "string", filterIndex: true },
    ],
  };
  await index.create(schema);
  assert.deepEqual(await index.schema("main"), schema);
  await index.upsert("main", [
    { id: 1, vectors: { v: [0, 0] }, attributes: { tag: "a", price: 5 } },
    { id: 2, vectors: { v: [1, 0] }, attributes: { tag: "b", price: 20 } },
    { id: 3, vectors: { v: [2, 0] }, attributes: { tag: "a", price: 30 } },
  ]);
  await index.build("main");
  const ids = async (filter: IndexFilter) => {
    const hits = await index.query("main", { column: "v", vector: [0, 0], topK: 5, filter });
    return hits.map((hit) => hit.id);
  };
  assert.deepEqual(await ids({ tag: { eq: "a" } }), [1, 3]);
  const altered = await index.alter("main", {
    vectors: [],
    attributes: [{ name: "price", type: "number", filterIndex: true }],
  });
  assert.deepEqual(
    altered.attributes.map((c) => [c.name, c.filterIndex]),
    [
      ["price", true],
      ["tag", true],
    ],
  );
  await index.build("main");
  assert.deepEqual(await ids({ and: [{ price: { gte: 20 } }, { tag: { eq: "a" } }] }), [3]);
  const list = {
    vectors: [],
    attributes: [{ name: "l", type: "strings" as const, filterIndex: true }],
  };
  await assert.rejects(index.alter("main", list), kind("invalid"));
});

test("a merge adds a branch's writes to another once", async () => {
  const { index } = await made();
  await index.upsert("main", [{ id: 1, vectors: { v: [0, 0] }, attributes: { tag: "a" } }]);
  await index.fork("main", "dev");
  await index.upsert("dev", [{ id: 1, vectors: { v: [0, 0] }, attributes: { tag: "dev" } }]);
  await index.upsert("dev", [{ id: 2, vectors: { v: [1, 0] }, attributes: { tag: "dev" } }]);
  assert.equal(await index.merge("main", "dev"), 2);
  assert.equal(await index.merge("main", "dev"), 0);
  assert.equal((await index.get("main", 1))?.attributes?.tag, "dev");
  assert.equal((await index.get("main", 2))?.attributes?.tag, "dev");
  await assert.rejects(index.merge("main", "nope"), kind("not_found"));
});

test("sparse and late-interaction vectors are written, read back and ranked", async () => {
  const folder = mkdtempSync(join(tmpdir(), "skywake-index-"));
  const index = Index.open(folder);
  await index.create({
    vectors: [{ name: "v", dims: 2, metric: "euclidean" }],
    attributes: [
      { name: "terms", type: "sparse" },
      { name: "tokens", type: "vectors" },
    ],
  });
  await index.upsert("main", [
    {
      id: 1,
      vectors: { v: [0, 0] },
      attributes: { terms: { indices: [9, 2], values: [1, 0.5] }, tokens: [[1, 0]] },
    },
    { id: 2, vectors: { v: [1, 0] }, attributes: { terms: { indices: [2], values: [3] } } },
  ]);
  const doc = await index.get("main", 1);
  assert.deepEqual(doc?.attributes?.terms, { indices: [2, 9], values: [0.5, 1] });
  assert.deepEqual(doc?.attributes?.tokens, [[1, 0]]);
  const { results } = await index.multi("main", [
    { rank: { score: { dot: { attribute: "terms", indices: [2], values: [2] } }, topK: 5 } },
    { rank: { score: { max_sim: { attribute: "tokens", vectors: [[0.5, 0]] } }, topK: 5 } },
  ]);
  assert.deepEqual(
    results[0]!.rank!.map((hit) => [hit.id, hit.score]),
    [
      [2, 6],
      [1, 1],
    ],
  );
  assert.deepEqual(
    results[1]!.rank!.map((hit) => [hit.id, hit.score]),
    [[1, 0.5]],
  );
});

test("a branch lists its versions, goes back to one, and forks from one", async () => {
  const { index } = await made();
  await index.upsert("main", [{ id: 1, vectors: { v: [0, 0] } }]);
  await index.upsert("main", [{ id: 2, vectors: { v: [1, 0] } }]);
  const versions = await index.versions("main", null, 10);
  assert.deepEqual(
    versions.map((v) => v.rows),
    [2, 1, 0],
  );
  assert.ok(versions[0]!.time >= versions[1]!.time && versions[1]!.time > 0);
  assert.deepEqual(await index.versions("main", versions[0]!.version, 1), [versions[1]]);
  const one = versions[1]!.version;
  const ids = async (branch: string) =>
    (await index.query(branch, { column: "v", vector: [0, 0], topK: 10 })).map((hit) => hit.id);

  await index.fork("main", "past", one);
  assert.deepEqual(await ids("past"), [1]);
  const restored = await index.restore("main", one, 7);
  assert.deepEqual(await ids("main"), [1]);
  assert.equal((await index.versions("main", null, 1))[0]!.version, restored);
  await assert.rejects(index.restore("main", versions[2]!.version, 0), kind("invalid"));
  await assert.rejects(index.restore("main", "f".repeat(64)), kind("not_found"));
  await assert.rejects(index.restore("main", "nope"), kind("invalid"));

  const kept = await index.collect({ dryRun: true });
  assert.equal(kept.deleted, 0);
  const collected = await index.collect({ retentionDays: 0, graceSeconds: 0 });
  assert.ok(collected.deleted > 0);
  assert.equal(collected.missing, 0);
  assert.deepEqual(await ids("main"), [1]);
  assert.deepEqual(await ids("past"), [1]);
  await assert.rejects(index.restore("main", versions[0]!.version), kind("not_found"));
});

test("an export comes out as a Parquet file", async () => {
  const { index } = await made();
  await index.upsert("main", [
    { id: 1, vectors: { v: [0, 0] }, attributes: { tag: "a", price: 5 } },
    { id: "two", vectors: { v: [1, 0] } },
  ]);
  const parts: Buffer[] = [];
  const file = await index.exportParquet("main");
  for (let part = await file.next(); part; part = await file.next()) parts.push(part);
  const bytes = Buffer.concat(parts);
  assert.equal(bytes.subarray(0, 4).toString(), "PAR1");
  assert.equal(bytes.subarray(-4).toString(), "PAR1");
  await assert.rejects(index.exportParquet("nope"), kind("not_found"));
});
