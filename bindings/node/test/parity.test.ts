import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  Index,
  type EngineError,
  type IndexDoc,
  type IndexFilter,
  type IndexSchema,
} from "../index.js";

const SCHEMA: IndexSchema = {
  vectors: [{ name: "v", dims: 2, metric: "euclidean", element: "f16" }],
  attributes: [
    { name: "at", type: "datetime" },
    { name: "n", type: "int" },
    { name: "path", type: "string" },
    { name: "price", type: "number" },
    { name: "ref", type: "uuid" },
    { name: "tags", type: "strings" },
  ],
};

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function docs(): IndexDoc[] {
  return [1, 2, 3, 4].map((i) => ({
    id: i,
    vectors: { v: [i, 0] },
    attributes: {
      at: `2026-01-0${i}T00:00:00Z`,
      n: i * 10,
      path: i % 2 ? `src/${i}.rs` : `docs/${i}.md`,
      price: i * 1.5,
      ref: UUID,
      tags: i % 2 ? ["odd"] : ["even", "x"],
    },
  }));
}

const folder = () => mkdtempSync(join(tmpdir(), "skywake-parity-"));
const kind = (expected: string) => (error: EngineError) => error.kind === expected;

async function made(shards = 1) {
  const location = folder();
  const index = Index.open(location, { shards });
  await index.create(SCHEMA);
  await index.upsert("main", docs());
  return index;
}

for (const shards of [1, 3]) {
  test(`types, filters, order and aggregates on ${shards} shard(s)`, async () => {
    const index = await made(shards);
    assert.deepEqual(await index.schema("main"), SCHEMA);
    const [one, ...rest] = await index.getMany("main", [1, 99]);
    assert.equal(rest.length, 0);
    assert.ok(one);
    assert.equal(one.attributes!.at, "2026-01-01T00:00:00.000Z");
    assert.equal(one.attributes!.ref, UUID);
    assert.equal(one.attributes!.n, 10);

    const ids = async (filter: IndexFilter) =>
      (await index.order("main", { by: "id", topK: 10, filter })).map((row) => row.id);
    assert.deepEqual(await ids({ path: { glob: "src/*" } }), [1, 3]);
    assert.deepEqual(await ids({ path: { regex: "\\.md$" } }), [2, 4]);
    assert.deepEqual(await ids({ tags: { contains_all: ["even", "x"] } }), [2, 4]);
    assert.deepEqual(await ids({ n: { ne: 10 } }), [2, 3, 4]);
    assert.deepEqual(await ids({ at: { gte: "2026-01-03" } }), [3, 4]);

    const rows = await index.order("main", {
      by: "price",
      descending: true,
      topK: 2,
      offset: 1,
      include: ["price"],
    });
    assert.deepEqual(rows, [
      { id: 3, attributes: { price: 4.5 } },
      { id: 2, attributes: { price: 3 } },
    ]);

    const groups = await index.aggregate("main", {
      groupBy: ["path"],
      filter: { tags: { contains_any: ["odd"] } },
      measures: { count: ["count"], sum: ["sum", "n"] },
    });
    assert.deepEqual(
      groups.map((g) => [g.key.path, g.values.count, g.values.sum]),
      [
        ["src/1.rs", 1, 10],
        ["src/3.rs", 1, 30],
      ],
    );

    const {
      results: [near, all],
      reads,
    } = await index.multi("main", [
      { query: { column: "v", vector: [0, 0], topK: 2, offset: 1 } },
      { aggregate: { measures: { avg: ["avg", "price"] } } },
    ]);
    assert.deepEqual(
      near?.query?.map((hit) => hit.id),
      [2, 3],
    );
    assert.deepEqual(all?.aggregate?.[0]?.values, { avg: 3.75 });
    assert.ok(["hot", "warm", "cold"].includes(reads.temperature));
    assert.ok(reads.hitRatio >= 0 && reads.hitRatio <= 1);

    // By id, and at most one per tag set.
    const near4 = (extra: object) => ({ column: "v", vector: [0, 0], topK: 4, ...extra });
    const { results } = await index.multi(
      "main",
      [
        { query: near4({ filter: { id: { in: [4, 2, 9] } } }) },
        { query: near4({ filter: { id: { ne: 1 } } }) },
        { query: near4({ per: { attributes: ["tags"], limit: 1 } }) },
      ],
      { eventual: true },
    );
    assert.deepEqual(
      results.map((result) => result.query?.map((hit) => hit.id)),
      [
        [2, 4],
        [2, 3, 4],
        [1, 2],
      ],
    );
    assert.deepEqual(results[2]?.query?.[0]?.attributes, {});
  });
}

test("writes patch, check conditions and delete by filter", async () => {
  const index = await made(2);
  const counts = await index.write("main", {
    patches: [
      { id: 1, attributes: { n: 11, tags: null } },
      { id: 99, attributes: { n: 1 } },
    ],
    upserts: [
      { id: 2, vectors: { v: [2, 0] }, attributes: { n: 5 } },
      { id: 3, vectors: { v: [3, 0] }, attributes: { n: 50 } },
    ],
    // Only if the new `n` is larger than the stored one.
    upsertIf: { n: { lt: { $ref_new: "n" } } },
    deleteBy: { path: { glob: "docs/*" } },
  });
  // 2 was deleted by the filter first; a missing document fails `lt`,
  // so its upsert is skipped. An upsert replaces every attribute.
  assert.deepEqual(counts, { upserted: 1, patched: 1, deleted: 2 });
  const left = await index.order("main", { by: "id", topK: 10, include: ["n", "tags"] });
  assert.deepEqual(left, [
    { id: 1, attributes: { n: 11 } },
    { id: 3, attributes: { n: 50 } },
  ]);
});

test("a write returns the ids it changed when asked", async () => {
  const index = await made(2);
  const write = (returnAffectedIds: boolean) =>
    index.write("main", {
      patches: [{ id: 1, attributes: { n: 11 } }],
      upserts: [{ id: 5, vectors: { v: [5, 0] } }],
      deletes: [3, 99],
      returnAffectedIds,
    });
  assert.deepEqual(await write(true), {
    upserted: 1,
    patched: 1,
    deleted: 2,
    upsertedIds: [5],
    patchedIds: [1],
    deletedIds: [3, 99],
  });
  assert.deepEqual(await write(false), { upserted: 1, patched: 1, deleted: 2 });
});

test("uuid ids take any form and come back lowercase with dashes", async () => {
  const index = Index.open(folder(), { shards: 3 });
  const schema: IndexSchema = { ...SCHEMA, id: "uuid" };
  await index.create(schema);
  assert.deepEqual(await index.schema("main"), schema);
  const upper = UUID.toUpperCase();
  const bare = UUID.replaceAll("-", "");
  await index.upsert("main", [{ id: upper, vectors: { v: [1, 0] } }]);
  assert.equal((await index.get("main", bare))?.id, UUID);
  const rows = await index.order("main", { by: "id", topK: 5, filter: { id: { eq: upper } } });
  assert.deepEqual(rows, [{ id: UUID, attributes: {} }]);
  const counts = await index.write("main", { deletes: [bare], returnAffectedIds: true });
  assert.deepEqual(counts.deletedIds, [UUID]);
  await assert.rejects(index.upsert("main", [{ id: 7, vectors: { v: [0, 0] } }]), kind("invalid"));
  await assert.rejects(index.get("main", "nope"), kind("invalid"));
});

test("export and copy hold every document", async () => {
  const index = await made(2);
  const exported: IndexDoc[] = [];
  const batches = await index.export("main");
  for (let batch = await batches.next(); batch; batch = await batches.next()) {
    exported.push(...batch);
  }
  assert.deepEqual(exported.map((doc) => doc.id).sort(), [1, 2, 3, 4]);

  const target = folder();
  await index.copy("main", target, { shards: 2 });
  const copy = Index.open(target, { shards: 2 });
  assert.equal((await copy.stats("main")).rows, 4);
  await assert.rejects(index.copy("main", folder(), { shards: 3 }), kind("invalid"));
});

test("bad input is refused", async () => {
  const index = await made();
  await assert.rejects(
    index.upsert("main", [{ id: 9, vectors: { v: [0, 0] }, attributes: { ref: "nope" } }]),
    kind("invalid"),
  );
  await assert.rejects(
    index.order("main", { by: "id", topK: 1, filter: { n: { glob: "1*" } } }),
    kind("invalid"),
  );
  await assert.rejects(
    index.multi("main", [{ order: { by: "id", topK: 1 }, aggregate: { measures: {} } }]),
    kind("invalid"),
  );
  assert.throws(() => Index.open(folder(), { kmsKeyId: "key" }), kind("invalid"));
});
