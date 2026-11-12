import assert from "node:assert/strict";
import { test } from "node:test";

import { server, skip } from "./helpers.ts";

const SCHEMA = {
  vectors: [{ name: "v", dims: 2, metric: "euclidean", element: "i8" }],
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

const DOCS = [1, 2, 3, 4].map((i) => ({
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

const MAIN = "/indexes/parity/branches/main";

async function made(shards = 2) {
  const s = await server();
  const { key } = await s.org();
  const created = await s.call("POST", "/indexes", key, { name: "parity", schema: SCHEMA, shards });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.shards, shards);
  assert.equal(created.body.encryption, null);
  const written = await s.call("POST", `${MAIN}/documents`, key, { documents: DOCS });
  assert.equal(written.status, 200, JSON.stringify(written.body));
  return { s, key };
}

test("new types, filters, order, aggregates and multi-queries", { skip }, async () => {
  const { s, key } = await made();
  const doc = await s.call("GET", `${MAIN}/documents/1`, key);
  assert.equal(doc.body.attributes.at, "2026-01-01T00:00:00.000Z");
  assert.equal(doc.body.attributes.ref, UUID);

  const ids = async (filter: object) => {
    const got = await s.call("POST", `${MAIN}/order`, key, { by: "id", topK: 10, filter });
    assert.equal(got.status, 200, JSON.stringify(got.body));
    return got.body.rows.map((row: any) => row.id);
  };
  assert.deepEqual(await ids({ path: { glob: "src/*" } }), [1, 3]);
  assert.deepEqual(await ids({ path: { regex: "md$" } }), [2, 4]);
  assert.deepEqual(await ids({ tags: { contains_all: ["even", "x"] } }), [2, 4]);
  assert.deepEqual(await ids({ n: { not_in: [10, 20] } }), [3, 4]);
  assert.deepEqual(await ids({ at: { gte: "2026-01-03" } }), [3, 4]);

  const ordered = await s.call("POST", `${MAIN}/order`, key, {
    by: "price",
    descending: true,
    topK: 2,
    offset: 1,
    include: ["price"],
  });
  assert.deepEqual(ordered.body.rows, [
    { id: 3, attributes: { price: 4.5 } },
    { id: 2, attributes: { price: 3 } },
  ]);

  const grouped = await s.call("POST", `${MAIN}/aggregate`, key, {
    groupBy: ["path"],
    filter: { tags: { contains_any: ["odd"] } },
    measures: { count: ["count"], total: ["sum", "n"] },
  });
  assert.equal(grouped.status, 200, JSON.stringify(grouped.body));
  assert.deepEqual(grouped.body.groups, [
    { key: { path: "src/1.rs" }, values: { count: 1, total: 10 } },
    { key: { path: "src/3.rs" }, values: { count: 1, total: 30 } },
  ]);

  const multi = await s.call("POST", `${MAIN}/multi`, key, {
    requests: [
      { query: { vector: { column: "v", value: [0, 0] }, topK: 2, offset: 1 } },
      { aggregate: { measures: { mean: ["avg", "price"] } } },
    ],
  });
  assert.equal(multi.status, 200, JSON.stringify(multi.body));
  assert.deepEqual(
    multi.body.results[0].query.map((hit: any) => hit.id),
    [2, 3],
  );
  assert.deepEqual(multi.body.results[1].aggregate, [{ key: {}, values: { mean: 3.75 } }]);

  const usage = await s.call("GET", "/indexes/parity/usage", key);
  assert.ok(usage.body.days.at(-1).queries >= 9);
});

test("queries filter by id, exclude attributes and limit hits per value", { skip }, async () => {
  const { s, key } = await made();
  const near = (extra: object) => ({ vector: { column: "v", value: [0, 0] }, topK: 4, ...extra });
  const ids = async (body: object) => {
    const got = await s.call("POST", `${MAIN}/query`, key, body);
    assert.equal(got.status, 200, JSON.stringify(got.body));
    return got.body.hits.map((hit: any) => hit.id);
  };
  assert.deepEqual(await ids(near({ filter: { id: { in: [4, 2, 9] } } })), [2, 4]);
  assert.deepEqual(await ids(near({ filter: { id: { not_in: [1] }, n: { lt: 40 } } })), [2, 3]);
  assert.deepEqual(await ids(near({ filter: { id: { gt: 1, lte: 3 } } })), [2, 3]);
  assert.deepEqual(await ids(near({ per: { attributes: ["tags"], limit: 1 } })), [1, 2]);

  const excluded = await s.call("POST", `${MAIN}/query`, key, {
    ...near({ topK: 1 }),
    exclude: ["at", "ref", "tags"],
  });
  assert.deepEqual(excluded.body.hits[0].attributes, { n: 10, path: "src/1.rs", price: 1.5 });

  const eventual = await s.call("POST", `${MAIN}/order`, key, {
    by: "n",
    topK: 1,
    consistency: "eventual",
  });
  assert.equal(eventual.status, 200, JSON.stringify(eventual.body));
  assert.deepEqual(eventual.body.rows, [{ id: 1, attributes: {} }]);
  assert.ok(eventual.body.performance.cache_temperature);
});

test("writes patch, check conditions and delete by filter", { skip }, async () => {
  const { s, key } = await made();
  const counts = await s.call("POST", `${MAIN}/write`, key, {
    patches: [{ id: 1, attributes: { n: 11, tags: null } }],
    upserts: [
      { id: 2, vectors: { v: [2, 0] }, attributes: { n: 5 } },
      { id: 3, vectors: { v: [3, 0] }, attributes: { n: 50 } },
    ],
    upsertIf: { n: { lt: { $ref_new: "n" } } },
    deleteBy: { path: { glob: "docs/*" } },
  });
  assert.equal(counts.status, 200, JSON.stringify(counts.body));
  assert.deepEqual(counts.body, {
    upserted: 1,
    patched: 1,
    deleted: 2,
    billing: { writes: 2, deletes: 2 },
  });
  const left = await s.call("POST", `${MAIN}/order`, key, { by: "id", include: ["n"] });
  assert.deepEqual(left.body.rows, [
    { id: 1, attributes: { n: 11 } },
    { id: 3, attributes: { n: 50 } },
  ]);
});

test("writes return the ids they changed when asked", { skip }, async () => {
  const { s, key } = await made();
  const counts = await s.call("POST", `${MAIN}/write`, key, {
    patches: [{ id: 1, attributes: { n: 11 } }],
    upserts: [{ id: 5, vectors: { v: [5, 0] } }],
    deletes: [3, 99],
    returnAffectedIds: true,
  });
  assert.equal(counts.status, 200, JSON.stringify(counts.body));
  assert.deepEqual(counts.body, {
    upserted: 1,
    patched: 1,
    deleted: 1,
    upserted_ids: [5],
    patched_ids: [1],
    deleted_ids: [3],
    billing: { writes: 2, deletes: 1 },
  });
  const upserted = await s.call("POST", `${MAIN}/documents`, key, {
    documents: [{ id: "six", vectors: { v: [6, 0] } }],
    returnAffectedIds: true,
  });
  assert.deepEqual(upserted.body.upserted_ids, ["six"]);
  const deleted = await s.call("POST", `${MAIN}/documents/delete`, key, {
    ids: [2, "six"],
    returnAffectedIds: true,
  });
  assert.deepEqual(deleted.body, { count: 2, deleted_ids: [2, "six"], billing: { deletes: 2 } });
  // Off by default.
  const plain = await s.call("POST", `${MAIN}/documents/delete`, key, { ids: [4] });
  assert.deepEqual(plain.body, { count: 1, billing: { deletes: 1 } });
});

test("uuid ids take any form and come back lowercase with dashes", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const schema = { ...SCHEMA, id: "uuid" };
  const created = await s.call("POST", "/indexes", key, { name: "uuids", schema, shards: 3 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.schema.id, "uuid");
  const at = "/indexes/uuids/branches/main";
  const upper = UUID.toUpperCase();
  const bare = UUID.replaceAll("-", "");
  const written = await s.call("POST", `${at}/documents`, key, {
    documents: [{ id: upper, vectors: { v: [1, 0] } }],
    returnAffectedIds: true,
  });
  assert.deepEqual(written.body.upserted_ids, [UUID]);
  assert.equal((await s.call("GET", `${at}/documents/${bare}`, key)).body.id, UUID);
  assert.equal((await s.call("GET", `${at}/documents/1`, key)).status, 404);
  const found = await s.call("POST", `${at}/order`, key, {
    by: "id",
    filter: { id: { eq: bare } },
  });
  assert.deepEqual(found.body.rows, [{ id: UUID, attributes: {} }]);
  const page = await s.call("GET", `${at}/documents?limit=1`, key);
  assert.deepEqual(page.body.documents[0].id, UUID);

  const refused = async (path: string, body: object, field: string) => {
    const got = await s.call("POST", path, key, body);
    assert.equal(got.status, 400, JSON.stringify(got.body));
    assert.equal(got.body.path, field, JSON.stringify(got.body));
  };
  const doc = { id: 7, vectors: { v: [0, 0] } };
  await refused(`${at}/documents`, { documents: [doc] }, "documents[0].id");
  await refused(`${at}/write`, { patches: [{ id: "x", attributes: {} }] }, "patches[0].id");
  await refused(`${at}/write`, { deletes: [UUID, "x"] }, "deletes[1]");
  await refused(`${at}/documents/delete`, { ids: [1] }, "ids[0]");
  await refused(`${at}/order`, { by: "id", filter: { id: { in: ["x"] } } }, "filter.id.in[0]");
});

test("export and copy hold every document", { skip }, async () => {
  const { s, key } = await made();
  const exported = await s.call("GET", `${MAIN}/export`, key);
  assert.equal(exported.status, 200);
  const lines = String(exported.body)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((doc) => doc.id).sort(), [1, 2, 3, 4]);

  const copied = await s.call("POST", "/indexes/parity/copy", key, { name: "parity-copy" });
  assert.equal(copied.status, 201, JSON.stringify(copied.body));
  assert.equal(copied.body.shards, 2);
  const rows = await s.call("POST", "/indexes/parity-copy/branches/main/order", key, {
    by: "id",
  });
  assert.equal(rows.body.rows.length, 4);
  // The copy is apart: a delete in it leaves the source whole.
  await s.call("POST", "/indexes/parity-copy/branches/main/documents/delete", key, { ids: [1] });
  const source = await s.call("POST", `${MAIN}/order`, key, { by: "id" });
  assert.equal(source.body.rows.length, 4);
});

test("bad parity input names the field that is wrong", { skip }, async () => {
  const { s, key } = await made(1);
  const refused = async (path: string, body: object, field: string) => {
    const got = await s.call("POST", path, key, body);
    assert.equal(got.status, 400, JSON.stringify(got.body));
    assert.equal(got.body.path, field, JSON.stringify(got.body));
  };
  const doc = (attributes: object, v = [1, 2]) => ({ id: 9, vectors: { v }, attributes });
  await refused(
    `${MAIN}/documents`,
    { documents: [doc({ ref: "nope" })] },
    "documents[0].attributes.ref",
  );
  await refused(`${MAIN}/documents`, { documents: [doc({ n: 1.5 })] }, "documents[0].attributes.n");
  await refused(`${MAIN}/documents`, { documents: [doc({}, [1.5, 2])] }, "documents[0].vectors.v");
  await refused(`${MAIN}/order`, { by: "tags" }, "by");
  await refused(`${MAIN}/order`, { by: "id", filter: { n: { glob: "1*" } } }, "filter.n.glob");
  await refused(
    `${MAIN}/order`,
    { by: "id", filter: { path: { contains_all: ["a"] } } },
    "filter.path.contains_all",
  );
  await refused(`${MAIN}/aggregate`, { measures: { s: ["sum", "path"] } }, "measures.s");
  await refused(
    `${MAIN}/write`,
    { deletes: [1], deleteIf: { n: { eq: { $ref_new: "nope" } } } },
    "deleteIf.n.eq.$ref_new",
  );
  const query = { vector: { column: "v", value: [0, 0] } };
  await refused(`${MAIN}/query`, { ...query, filter: { id: { lt: [3] } } }, "filter.id.lt");
  await refused(`${MAIN}/query`, { ...query, filter: { id: { in: [-1] } } }, "filter.id.in[0]");
  await refused(`${MAIN}/query`, { ...query, include: ["n"], exclude: ["at"] }, "exclude");
  await refused(
    `${MAIN}/query`,
    { ...query, per: { attributes: ["x"], limit: 1 } },
    "per.attributes[0]",
  );
  await refused(
    `${MAIN}/multi`,
    { requests: [{ order: { by: "id", consistency: "eventual" } }] },
    "requests[0].order.consistency",
  );
  const empty = await s.call("POST", `${MAIN}/write`, key, {});
  assert.equal(empty.status, 400);

  const encrypted = await s.call("POST", "/indexes", key, {
    name: "locked",
    schema: SCHEMA,
    encryption: { kms_key_id: "alias/skywake" },
  });
  // The local store takes no key, and the name stays free.
  assert.equal(encrypted.status, 400, JSON.stringify(encrypted.body));
  assert.equal((await s.call("GET", "/indexes/locked", key)).status, 404);
});

test(
  "writes make indexes, add attributes, flatten objects; read-only refuses them",
  { skip },
  async () => {
    const s = await server();
    const { key } = await s.org();
    const NEW = "/indexes/grown/branches/main";
    const first = {
      id: 1,
      vectors: { v: [1, 0, 0] },
      attributes: { tag: "a", author: { name: "ann", age: 30 } },
    };
    const made = await s.call("POST", `${NEW}/documents`, key, { documents: [first] });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const index = await s.call("GET", "/indexes/grown", key);
    assert.deepEqual(index.body.schema, {
      vectors: [{ name: "v", dims: 3, metric: "cosine" }],
      attributes: [
        { name: "tag", type: "string" },
        { name: "author.name", type: "string" },
        { name: "author.age", type: "number" },
      ],
    });
    assert.equal(index.body.read_only, false);

    // A new attribute on a branch made before it is added there too.
    const fork = await s.call("POST", "/indexes/grown/branches", key, { name: "dev" });
    assert.equal(fork.status, 201, JSON.stringify(fork.body));
    const second = { id: 2, vectors: { v: [0, 1, 0] }, attributes: { tag: "b", stars: 4 } };
    const grown = await s.call("POST", `${NEW}/documents`, key, { documents: [second] });
    assert.equal(grown.status, 200, JSON.stringify(grown.body));
    const onDev = await s.call("POST", "/indexes/grown/branches/dev/documents", key, {
      documents: [{ ...second, id: 3 }],
    });
    assert.equal(onDev.status, 200, JSON.stringify(onDev.body));
    const ids = async (filter: object) => {
      const got = await s.call("POST", `${NEW}/order`, key, { by: "id", topK: 10, filter });
      assert.equal(got.status, 200, JSON.stringify(got.body));
      return got.body.rows.map((row: any) => row.id);
    };
    assert.deepEqual(await ids({ stars: { gte: 3 } }), [2]);
    assert.deepEqual(await ids({ "author.name": { eq: "ann" } }), [1]);
    const wrongType = await s.call("POST", `${NEW}/documents`, key, {
      documents: [{ id: 4, vectors: { v: [1, 1, 0] }, attributes: { stars: "many" } }],
    });
    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.body.path, "documents[0].attributes.stars");

    // Added by hand, then read-only until made writable again.
    const patched = await s.call("PATCH", "/indexes/grown", key, {
      attributes: [{ name: "body", type: "text" }],
      read_only: true,
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.read_only, true);
    assert.ok(patched.body.schema.attributes.some((c: any) => c.name === "body"));
    const refused = await s.call("POST", `${NEW}/documents`, key, { documents: [second] });
    assert.equal(refused.status, 403);
    const retyped = await s.call("PATCH", "/indexes/grown", key, {
      attributes: [{ name: "tag", type: "int" }],
    });
    assert.equal(retyped.status, 400);
    await s.call("PATCH", "/indexes/grown", key, { read_only: false });
    const text = { id: 5, vectors: { v: [0, 0, 1] }, attributes: { body: "reset the password" } };
    assert.equal(
      (await s.call("POST", `${NEW}/documents`, key, { documents: [text] })).status,
      200,
    );
    const found = await s.call("POST", `${NEW}/search`, key, { query: "password", topK: 3 });
    assert.deepEqual(
      found.body.hits.map((hit: any) => hit.id),
      [5],
    );

    // A new index needs vectors as numbers.
    const words = await s.call("POST", "/indexes/words/branches/main/documents", key, {
      documents: [{ id: 1, vectors: { v: "hello" } }],
    });
    assert.equal(words.status, 400);
    assert.equal((await s.call("GET", "/indexes/words", key)).status, 404);
  },
);

test("warming runs after the answer, and recall is measured against exact", { skip }, async () => {
  const { s, key } = await made(1);
  const warm = await s.call("POST", `${MAIN}/warm`, key);
  assert.equal(warm.status, 202, JSON.stringify(warm.body));
  assert.equal(warm.body.kind, "warm");
  assert.equal((await s.call("POST", "/indexes/parity/branches/nope/warm", key)).status, 404);

  const checked = await s.call("POST", `${MAIN}/recall`, key, { queries: 3, topK: 2 });
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  // Four documents, all in the tail: every query is exact.
  assert.deepEqual(checked.body, { recall: 1, queries: 3, found: 2, exact: 2 });
  const filtered = await s.call("POST", `${MAIN}/recall`, key, {
    filter: { n: { gte: 30 } },
    topK: 5,
  });
  assert.deepEqual([filtered.body.queries, filtered.body.exact], [4, 2]);
  const bad = await s.call("POST", `${MAIN}/recall`, key, { filter: { nope: { eq: 1 } } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.path, "filter.nope");
});

test(
  "sparse and late-interaction vectors are inferred, kept whole and ranked",
  { skip },
  async () => {
    const { s, key } = await made(2);
    const written = await s.call("POST", `${MAIN}/documents`, key, {
      documents: [
        {
          id: 1,
          vectors: { v: [1, 0] },
          attributes: { terms: { indices: [9, 2], values: [1, 0.5] }, tokens: [[1, 0]] },
        },
        { id: 2, vectors: { v: [2, 0] }, attributes: { terms: { indices: [2], values: [3] } } },
      ],
    });
    assert.equal(written.status, 200, JSON.stringify(written.body));
    const index = await s.call("GET", "/indexes/parity", key);
    const types = Object.fromEntries(
      index.body.schema.attributes.map((a: any) => [a.name, a.type]),
    );
    assert.deepEqual([types.terms, types.tokens], ["sparse", "vectors"]);
    const doc = await s.call("GET", `${MAIN}/documents/1`, key);
    assert.deepEqual(doc.body.attributes.terms, { indices: [2, 9], values: [0.5, 1] });

    const dot = { dot: { attribute: "terms", indices: [9, 2], values: [1, 2] } };
    const ranked = await s.call("POST", `${MAIN}/rank`, key, { score: dot, include: ["tokens"] });
    assert.equal(ranked.status, 200, JSON.stringify(ranked.body));
    assert.deepEqual(ranked.body.hits, [
      { id: 2, score: 6, attributes: {} },
      { id: 1, score: 2, attributes: { tokens: [[1, 0]] } },
    ]);
    assert.equal(ranked.body.billing.queries, 1);
    const multi = await s.call("POST", `${MAIN}/multi`, key, {
      requests: [
        { rank: { score: { max_sim: { attribute: "tokens", vectors: [[0.5, 0]] } }, topK: 5 } },
        { rank: { score: dot, topK: 1, offset: 1, filter: { n: { gte: 30 } } } },
      ],
    });
    assert.equal(multi.status, 200, JSON.stringify(multi.body));
    assert.deepEqual(
      multi.body.results[0].rank.map((hit: any) => [hit.id, hit.score]),
      [[1, 0.5]],
    );
    assert.deepEqual(multi.body.results[1].rank, []);

    const bad = async (body: object, path: string) => {
      const got = await s.call("POST", `${MAIN}/rank`, key, body);
      assert.equal(got.status, 400, JSON.stringify(got.body));
      assert.equal(got.body.path, path);
    };
    await bad(
      { score: { dot: { attribute: "n", indices: [1], values: [1] } } },
      "score.dot.attribute",
    );
    await bad(
      { score: { dot: { attribute: "terms", indices: [1, 1], values: [1, 2] } } },
      "score.dot",
    );
    await bad(
      { score: { max_sim: { attribute: "tokens", vectors: [[1], [1, 2]] } } },
      "score.max_sim.vectors",
    );
    await bad({ score: dot, filter: { terms: { eq: 1 } } }, "filter.terms");
    const order = await s.call("POST", `${MAIN}/order`, key, { by: "tokens" });
    assert.equal(order.status, 400);
    const wrong = await s.call("POST", `${MAIN}/documents`, key, {
      documents: [{ id: 3, vectors: { v: [3, 0] }, attributes: { tokens: [[1, 0], [1]] } }],
    });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.path, "documents[0].attributes.tokens");
  },
);
