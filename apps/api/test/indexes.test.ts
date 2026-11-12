import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

import { server, skip } from "./helpers.ts";

const SCHEMA = {
  vectors: [{ name: "embedding", dims: 2, metric: "euclidean" }],
  attributes: [
    { name: "tag", type: "string" },
    { name: "price", type: "number" },
    { name: "labels", type: "strings" },
  ],
};

const DOCS = [
  { id: 1, vectors: { embedding: [0, 0] }, attributes: { tag: "billing", price: 5 } },
  { id: "two", vectors: { embedding: [1, 0] }, attributes: { tag: "billing", price: 20 } },
  { id: 3, vectors: { embedding: [2, 0] }, attributes: { tag: "search", labels: ["a", "b"] } },
];

const IX = "/indexes/prod%2Fproducts";
const MAIN = `${IX}/branches/main`;

async function made() {
  const s = await server();
  const { id, key } = await s.org();
  const created = await s.call("POST", "/indexes", key, { name: "prod/products", schema: SCHEMA });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { s, id, key };
}

const near = (vector = [0, 0], extra: object = {}) => ({
  vector: { column: "embedding", value: vector },
  ...extra,
});

test("an index is made, listed, read and deleted", { skip }, async () => {
  const { s, key } = await made();
  const list = await s.call("GET", "/indexes", key);
  assert.deepEqual(
    list.body.map((index: any) => [index.name, index.region]),
    [["prod/products", "local"]],
  );
  assert.equal(list.body[0].schema.vectors[0].metric, "euclidean");

  const got = await s.call("GET", IX, key);
  assert.equal(got.status, 200);
  assert.equal(got.body.name, "prod/products");
  assert.ok("stats" in got.body);

  const again = await s.call("POST", "/indexes", key, { name: "prod/products", schema: SCHEMA });
  assert.equal(again.status, 409);

  // A cosine column by default.
  await s.call("POST", "/indexes", key, {
    name: "other",
    schema: { vectors: [{ name: "v", dims: 3 }] },
  });
  const other = await s.call("GET", "/indexes/other", key);
  assert.deepEqual(other.body.schema, {
    vectors: [{ name: "v", dims: 3, metric: "cosine" }],
    attributes: [],
  });
  const paged = await s.call("GET", "/indexes?limit=1&after=other", key);
  assert.deepEqual(
    paged.body.map((index: any) => index.name),
    ["prod/products"],
  );

  assert.equal((await s.call("DELETE", IX, key)).status, 204);
  assert.equal((await s.call("GET", IX, key)).status, 404);
  assert.equal((await s.call("POST", `${MAIN}/query`, key, near())).status, 404);

  const actions = (await s.call("GET", "/audit?limit=1000", key)).body.events.map(
    (event: any) => event.action,
  );
  assert.ok(actions.includes("createIndex") && actions.includes("deleteIndex"));
});

test("a bad schema is refused with the path of the bad field", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const create = (schema: unknown) => s.call("POST", "/indexes", key, { name: "x", schema });

  const metric = await create({ vectors: [{ name: "v", dims: 2, metric: "manhattan" }] });
  assert.equal(metric.status, 400);
  assert.equal(metric.body.code, "invalid");
  assert.equal(metric.body.path, "schema.vectors[0].metric");

  const word = await create({
    vectors: [{ name: "v", dims: 2 }],
    attributes: [{ name: "and", type: "string" }],
  });
  assert.equal(word.body.path, "schema.attributes[0].name");

  const twice = await create({
    vectors: [
      { name: "v", dims: 2 },
      { name: "v", dims: 3 },
    ],
  });
  assert.equal(twice.body.path, "schema.vectors");
  assert.equal((await create({ vectors: [] })).body.path, "schema.vectors");
  assert.equal((await create({ vectors: [{ name: "v", dims: 0 }] })).status, 400);

  const stopwords = await create({
    attributes: [{ name: "t", type: "text", language: "arabic", stopwords: true }],
  });
  assert.equal(stopwords.body.path, "schema.attributes[0].stopwords");
  const language = await create({
    vectors: [{ name: "v", dims: 2 }],
    attributes: [{ name: "t", type: "string", language: "french" }],
  });
  assert.equal(language.status, 400);
});

test("documents are written, queried with filters, and deleted", { skip }, async () => {
  const { s, key } = await made();
  const upsert = await s.call("POST", `${MAIN}/documents`, key, { documents: DOCS });
  assert.equal(upsert.status, 200, JSON.stringify(upsert.body));
  assert.deepEqual(upsert.body, { count: 3, billing: { writes: 3 } });
  const counted = await s.call("GET", MAIN, key);
  assert.equal(counted.body.stats.rows, 3);
  assert.equal((await s.call("GET", IX, key)).body.stats.rows, 3);

  const all = await s.call("POST", `${MAIN}/query`, key, near([0, 0], { topK: 2 }));
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.hits, [
    { id: 1, distance: 0, attributes: {} },
    { id: "two", distance: 1, attributes: {} },
  ]);
  const { cache_temperature, cache_hit_ratio, server_ms } = all.body.performance;
  assert.ok(["hot", "warm", "cold"].includes(cache_temperature));
  assert.ok(cache_hit_ratio >= 0 && cache_hit_ratio <= 1 && server_ms >= 0);

  const filter = { and: [{ tag: { eq: "billing" } }, { price: { gt: 10 } }] };
  const filtered = await s.call(
    "POST",
    `${MAIN}/query`,
    key,
    near([0, 0], { filter, include: ["tag", "price"] }),
  );
  assert.deepEqual(filtered.body.hits, [
    { id: "two", distance: 1, attributes: { tag: "billing", price: 20 } },
  ]);

  const labelled = await s.call(
    "POST",
    `${MAIN}/query`,
    key,
    near([0, 0], {
      filter: { or: [{ labels: { in: ["b"] } }, { not: { tag: { eq: "billing" } } }] },
    }),
  );
  assert.deepEqual(
    labelled.body.hits.map((hit: any) => hit.id),
    [3],
  );

  const deleted = await s.call("POST", `${MAIN}/documents/delete`, key, { ids: [1, "two"] });
  assert.deepEqual(deleted.body, { count: 2, billing: { deletes: 2 } });
  const left = await s.call("POST", `${MAIN}/query`, key, near());
  assert.deepEqual(
    left.body.hits.map((hit: any) => hit.id),
    [3],
  );

  const build = await s.call("POST", `${MAIN}/build`, key);
  assert.equal(build.status, 202);
  assert.deepEqual([build.body.kind, build.body.status], ["build", "running"]);
  // The build runs after the answer; queries keep working meanwhile and after.
  const operation = `${IX}/operations/${build.body.id}`;
  for (let tries = 0; (await s.call("GET", operation, key)).body.status === "running"; tries++) {
    assert.ok(tries < 100, "the build never finished");
    await sleep(20);
  }
  const done = await s.call("GET", operation, key);
  assert.deepEqual([done.body.status, done.body.error], ["done", null]);
  assert.ok(done.body.finished);
  assert.equal((await s.call("GET", `${IX}/operations/op_nope`, key)).status, 404);
  const built = await s.call("POST", `${MAIN}/query`, key, near([2, 0], { probe: 4 }));
  assert.deepEqual(
    built.body.hits.map((hit: any) => hit.id),
    [3],
  );
  assert.equal((await s.call("POST", `${IX}/branches/nope/build`, key)).status, 404);

  const actions = (await s.call("GET", "/audit?limit=1000", key)).body.events.map(
    (event: any) => event.action,
  );
  for (const action of ["upsertDocuments", "deleteDocuments", "buildIndex", "queryIndex"]) {
    assert.ok(actions.includes(action), action);
  }
});

test("documents are listed in pages by id and read one at a time", { skip }, async () => {
  const { s, key } = await made();
  const more = [{ id: "42", vectors: { embedding: [5, 5] } }, ...DOCS];
  await s.call("POST", `${MAIN}/documents`, key, { documents: more });

  const first = await s.call("GET", `${MAIN}/documents?limit=2`, key);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  // Number ids first, then string ids.
  assert.deepEqual(
    first.body.documents.map((doc: any) => doc.id),
    [1, 3],
  );
  assert.deepEqual(first.body.documents[1], {
    id: 3,
    vectors: { embedding: [2, 0] },
    attributes: { tag: "search", labels: ["a", "b"] },
  });
  const rest = await s.call("GET", `${MAIN}/documents?cursor=${first.body.next}`, key);
  assert.deepEqual(
    rest.body.documents.map((doc: any) => doc.id),
    ["42", "two"],
  );
  assert.equal(rest.body.next, null);
  const bad = await s.call("GET", `${MAIN}/documents?cursor=nope`, key);
  assert.equal(bad.status, 400);

  // `1` is the number id; `42` has no number id, so it is the string one.
  assert.equal((await s.call("GET", `${MAIN}/documents/1`, key)).body.id, 1);
  assert.equal((await s.call("GET", `${MAIN}/documents/42`, key)).body.id, "42");
  assert.equal((await s.call("GET", `${MAIN}/documents/two`, key)).body.attributes.price, 20);
  assert.equal((await s.call("GET", `${MAIN}/documents/9`, key)).status, 404);
  assert.equal((await s.call("GET", `${IX}/branches/nope/documents`, key)).status, 404);
});

test("a query takes a recall target", { skip }, async () => {
  const { s, key } = await made();
  await s.call("POST", `${MAIN}/documents`, key, { documents: DOCS });
  const exact = await s.call("POST", `${MAIN}/query`, key, near([2, 0], { recall: 1, topK: 1 }));
  assert.equal(exact.status, 200, JSON.stringify(exact.body));
  assert.deepEqual(
    exact.body.hits.map((hit: any) => hit.id),
    [3],
  );
  const bad = await s.call("POST", `${MAIN}/query`, key, near([0, 0], { recall: 1.5 }));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.path, "recall");
});

test("usage counts queries, writes and size per day", { skip }, async () => {
  const { s, key } = await made();
  await s.call("POST", `${MAIN}/documents`, key, { documents: DOCS });
  await s.call("POST", `${MAIN}/documents/delete`, key, { ids: [1] });
  await s.call("POST", `${MAIN}/query`, key, near());
  await s.call("POST", `${MAIN}/query`, key, near());
  await s.call("GET", IX, key);

  const usage = await s.call("GET", `${IX}/usage?days=3`, key);
  assert.equal(usage.status, 200, JSON.stringify(usage.body));
  assert.equal(usage.body.days.length, 3);
  const [before, , today] = usage.body.days;
  assert.deepEqual(
    { ...before, day: undefined },
    {
      day: undefined,
      queries: 0,
      writes: 0,
      deletes: 0,
      embeddings: 0,
      reranks: 0,
      rows: null,
      bytes: null,
    },
  );
  assert.equal(today.day, new Date().toISOString().slice(0, 10));
  assert.deepEqual([today.queries, today.writes, today.deletes, today.rows], [2, 3, 1, 2]);
  assert.ok(today.bytes > 0);
});

test("bad documents and queries name the field that is wrong", { skip }, async () => {
  const { s, key } = await made();
  const upsert = (documents: unknown[]) => s.call("POST", `${MAIN}/documents`, key, { documents });
  const query = (body: object) => s.call("POST", `${MAIN}/query`, key, body);
  const pathOf = async (answer: Promise<{ status: number; body: any }>) => {
    const { status, body } = await answer;
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(body.code, "invalid");
    return body.path;
  };

  assert.equal(
    await pathOf(upsert([DOCS[0], { id: 9, vectors: { embedding: [1, 2, 3] } }])),
    "documents[1].vectors.embedding",
  );
  assert.equal(await pathOf(upsert([{ id: 9, vectors: {} }])), "documents[0].vectors");
  assert.equal(
    await pathOf(upsert([{ id: 9, vectors: { embedding: [0, 0] }, attributes: { price: "x" } }])),
    "documents[0].attributes.price",
  );
  assert.equal(
    await pathOf(upsert([{ id: 9, vectors: { embedding: [0, 0] }, attributes: { "9lives": 1 } }])),
    "documents[0].attributes.9lives",
  );
  assert.equal(
    await pathOf(upsert([{ id: -1, vectors: { embedding: [0, 0] } }])),
    "documents[0].id",
  );
  const many = Array.from({ length: 1001 }, (_, id) => ({ id, vectors: { embedding: [0, 0] } }));
  assert.equal(await pathOf(upsert(many)), "documents");

  assert.equal(
    await pathOf(query({ vector: { column: "image", value: [0, 0] } })),
    "vector.column",
  );
  assert.equal(await pathOf(query(near([0, 0, 0]))), "vector.value");
  assert.equal(await pathOf(query(near([0, 0], { include: ["tag", "nope"] }))), "include[1]");
  assert.equal(await pathOf(query(near([0, 0], { topK: 0 }))), "topK");
  assert.equal(
    await pathOf(
      query(near([0, 0], { filter: { and: [{ tag: { eq: "a" } }, { price: { near: 1 } }] } })),
    ),
    "filter.and[1].price.near",
  );
  assert.equal(
    await pathOf(query(near([0, 0], { filter: { price: { lt: "cheap" } } }))),
    "filter.price.lt",
  );
  assert.equal(
    await pathOf(query(near([0, 0], { filter: { tag: { in: ["a", 2] } } }))),
    "filter.tag.in[1]",
  );
  assert.equal(
    await pathOf(query(near([0, 0], { filter: { tag: { contains_all: ["a"] } } }))),
    "filter.tag.contains_all",
  );
  assert.equal(await pathOf(query(near([0, 0], { filter: { or: [] } }))), "filter.or");
  assert.equal(await pathOf(query(near([0, 0], { filter: { color: { eq: 1 } } }))), "filter.color");
});

test("index branches fork, keep their own writes, and are deleted", { skip }, async () => {
  const { s, key } = await made();
  await s.call("POST", `${MAIN}/documents`, key, { documents: DOCS.slice(0, 1) });
  const fork = await s.call("POST", `${IX}/branches`, key, { name: "agents/try" });
  assert.equal(fork.status, 201, JSON.stringify(fork.body));
  assert.equal(fork.body.forked_from, "main");
  assert.equal((await s.call("POST", `${IX}/branches`, key, { name: "agents/try" })).status, 409);
  assert.equal(
    (await s.call("POST", `${IX}/branches`, key, { name: "x", from: "nope" })).status,
    404,
  );

  const TRY = `${IX}/branches/agents%2Ftry`;
  await s.call("POST", `${TRY}/documents`, key, { documents: DOCS.slice(1) });
  const ids = async (branch: string) =>
    (await s.call("POST", `${branch}/query`, key, near())).body.hits.map((hit: any) => hit.id);
  assert.deepEqual(await ids(MAIN), [1]);
  assert.deepEqual(await ids(TRY), [1, "two", 3]);

  const list = await s.call("GET", `${IX}/branches`, key);
  assert.deepEqual(
    list.body.map((branch: any) => branch.name),
    ["agents/try", "main"],
  );
  const page = await s.call("GET", `${IX}/branches?limit=1&after=agents%2Ftry`, key);
  assert.deepEqual(
    page.body.map((branch: any) => branch.name),
    ["main"],
  );
  const got = await s.call("GET", TRY, key);
  assert.equal(got.status, 200);
  assert.equal(got.body.name, "agents/try");

  const merged = await s.call("POST", `${MAIN}/merge`, key, { from: "agents/try" });
  assert.deepEqual([merged.status, merged.body], [200, { rows: 2 }]);
  assert.deepEqual(await ids(MAIN), [1, "two", 3]);
  assert.deepEqual((await s.call("POST", `${MAIN}/merge`, key, { from: "agents/try" })).body, {
    rows: 0,
  });
  assert.equal((await s.call("POST", `${MAIN}/merge`, key, { from: "nope" })).status, 404);

  assert.equal((await s.call("DELETE", `${IX}/branches/main`, key)).status, 409);
  assert.equal((await s.call("DELETE", TRY, key)).status, 204);
  assert.equal((await s.call("DELETE", TRY, key)).status, 404);
  assert.equal((await s.call("GET", TRY, key)).status, 404);
  assert.equal((await s.call("POST", `${TRY}/query`, key, near())).status, 404);
});

test("keys reach indexes by role and name pattern", { skip }, async () => {
  const { s, key } = await made();
  const keyOf = async (role: string, namespaces = "*") =>
    (await s.call("POST", "/keys", key, { name: role, role, namespaces })).body.key as string;
  const reader = await keyOf("read");
  const writer = await keyOf("write");
  const staging = await keyOf("admin", "staging/*");

  assert.equal((await s.call("GET", IX)).status, 401);
  assert.equal((await s.call("GET", IX, reader)).status, 200);
  assert.equal((await s.call("POST", `${MAIN}/query`, reader, near())).status, 200);
  const write = { documents: DOCS };
  assert.equal((await s.call("POST", `${MAIN}/documents`, reader, write)).status, 403);
  assert.equal(
    (await s.call("POST", `${MAIN}/documents/delete`, reader, { ids: [1] })).status,
    403,
  );
  assert.equal((await s.call("POST", `${IX}/branches`, reader, { name: "x" })).status, 403);
  assert.equal((await s.call("POST", `${MAIN}/build`, reader)).status, 403);

  assert.equal((await s.call("POST", `${MAIN}/documents`, writer, write)).status, 200);
  assert.equal((await s.call("POST", `${IX}/branches`, writer, { name: "x" })).status, 201);
  assert.equal((await s.call("DELETE", `${IX}/branches/x`, writer)).status, 204);
  const create = { name: "prod/more", schema: SCHEMA };
  assert.equal((await s.call("POST", "/indexes", writer, create)).status, 403);
  assert.equal((await s.call("DELETE", IX, writer)).status, 403);

  assert.equal((await s.call("GET", IX, staging)).status, 403);
  assert.deepEqual((await s.call("GET", "/indexes", staging)).body, []);
  assert.equal((await s.call("POST", "/indexes", staging, create)).status, 403);
  const own = { name: "staging/products", schema: SCHEMA };
  assert.equal((await s.call("POST", "/indexes", staging, own)).status, 201);

  const other = await s.org();
  assert.equal((await s.call("GET", IX, other.key)).status, 404);
  assert.equal((await s.call("POST", `${MAIN}/query`, other.key, near())).status, 404);
});

test("text takes a language, stopwords and token filters", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const body = { name: "body", type: "text", language: "french", stopwords: true };
  const created = await s.call("POST", "/indexes", key, {
    name: "fr",
    schema: { attributes: [body] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const FR = "/indexes/fr/branches/main";
  const documents = [
    { id: 1, attributes: { body: "Le cheval de la maison" } },
    { id: 2, attributes: { body: "Les chevaux courent" } },
    { id: 3, attributes: { body: "Une maison blanche" } },
  ];
  assert.equal((await s.call("POST", `${FR}/documents`, key, { documents })).status, 200);
  const ids = async (search: object) => {
    const found = await s.call("POST", `${FR}/search`, key, search);
    assert.equal(found.status, 200, JSON.stringify(found.body));
    return found.body.hits.map((hit: any) => hit.id).sort();
  };
  // "chevaux" stems to "cheval"; "le" and "de" are dropped.
  assert.deepEqual(await ids({ query: "chevaux" }), [1, 2]);
  assert.deepEqual(await ids({ query: "le de" }), []);
  assert.deepEqual(
    await ids({
      query: "maison",
      filter: { body: { contains_all_tokens: "les chevaux maisons" } },
    }),
    [1],
  );
  assert.deepEqual(
    await ids({
      query: "maison cheval",
      filter: { and: [{ body: { contains_any_token: "chevaux blanches" } }] },
    }),
    [1, 2, 3],
  );
  const nested = await s.call("POST", `${FR}/search`, key, {
    query: "x",
    filter: { not: { body: { contains_any_token: "x" } } },
  });
  assert.equal(nested.body.path, "filter.not.body.contains_any_token");
  // A text attribute keeps its language.
  const relanguaged = await s.call("PATCH", "/indexes/fr", key, {
    attributes: [{ ...body, language: "german" }],
  });
  assert.equal(relanguaged.status, 400);
  const same = await s.call("PATCH", "/indexes/fr", key, { attributes: [body] });
  assert.equal(same.status, 200, JSON.stringify(same.body));
});

test("text options, existence and fuzzy filters, prefixes and drops", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const created = await s.call("POST", "/indexes", key, {
    name: "shop",
    schema: {
      attributes: [
        { name: "title", type: "text", filterable: true, case_sensitive: true, stemming: false },
        { name: "body", type: "text", ascii_folding: true },
        { name: "tags", type: "text", pre_tokenized: true },
        { name: "color", type: "string" },
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const SHOP = "/indexes/shop/branches/main";
  const documents = [
    {
      id: 1,
      attributes: { title: "Running Shoes", body: "café", tags: ["New York"], color: "red" },
    },
    { id: 2, attributes: { title: "running socks", body: "cafe noir", tags: ["new york"] } },
    { id: 3, attributes: { title: "Runner", body: "the runway", tags: ["Paris"], color: "rot" } },
  ];
  const wrote = await s.call("POST", `${SHOP}/documents`, key, { documents });
  assert.equal(wrote.status, 200, JSON.stringify(wrote.body));
  const ids = async (path: string, body: object) => {
    const found = await s.call("POST", `${SHOP}${path}`, key, body);
    assert.equal(found.status, 200, JSON.stringify(found.body));
    return (found.body.hits ?? found.body.rows).map((hit: any) => hit.id);
  };
  assert.deepEqual(await ids("/search", { query: "Running", fields: ["title"] }), [1]);
  assert.deepEqual((await ids("/search", { query: "cafe", fields: ["body"] })).sort(), [1, 2]);
  assert.deepEqual(await ids("/search", { query: "New York", fields: ["tags"] }), [1]);
  assert.deepEqual(
    await ids("/search", { query: "the run", fields: ["body"], lastAsPrefix: true }),
    [3],
  );
  const search = (filter: object) => ids("/search", { query: "cafe runway", filter });
  assert.deepEqual(await search({ title: { eq: "Runner" } }), [3]);
  assert.deepEqual((await search({ color: { exists: false } })).sort(), [2]);
  assert.deepEqual((await search({ id: { gt: 1 } })).sort(), [2, 3]);
  assert.deepEqual((await search({ color: { fuzzy: { text: "rod", edits: 1 } } })).sort(), [1, 3]);
  assert.deepEqual(await ids("/order", { by: "title", topK: 3 }), [3, 1, 2]);

  const dropped = await s.call("PATCH", "/indexes/shop", key, { drop_attributes: ["color"] });
  assert.equal(dropped.status, 200, JSON.stringify(dropped.body));
  assert.ok(!dropped.body.schema.attributes.some((c: any) => c.name === "color"));
  const back = await s.call("PATCH", "/indexes/shop", key, {
    attributes: [{ name: "color", type: "int" }],
  });
  assert.equal(back.status, 400);
});

test("a filter index is declared, turned on online and refused on a list", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const attributes = [
    { name: "tag", type: "string", filter_index: true },
    { name: "price", type: "number" },
  ];
  const schema = { vectors: [{ name: "v", dims: 2, metric: "euclidean" }], attributes };
  const created = await s.call("POST", "/indexes", key, { name: "f", schema });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const listed = await s.call("POST", "/indexes", key, {
    name: "g",
    schema: { ...schema, attributes: [{ name: "l", type: "strings", filter_index: true }] },
  });
  assert.equal(listed.status, 400);
  assert.equal(listed.body.path, "schema.attributes[0].filter_index");

  const F = "/indexes/f/branches/main";
  const documents = [
    { id: 1, vectors: { v: [0, 0] }, attributes: { tag: "a", price: 5 } },
    { id: 2, vectors: { v: [1, 0] }, attributes: { tag: "b", price: 20 } },
    { id: 3, vectors: { v: [2, 0] }, attributes: { tag: "a", price: 30 } },
  ];
  assert.equal((await s.call("POST", `${F}/documents`, key, { documents })).status, 200);
  const on = await s.call("PATCH", "/indexes/f", key, {
    attributes: [{ name: "price", type: "number", filter_index: true }],
  });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.deepEqual(on.body.schema.attributes, [
    { name: "tag", type: "string", filter_index: true },
    { name: "price", type: "number", filter_index: true },
  ]);
  const query = { vector: { column: "v", value: [0, 0] }, filter: { price: { gte: 20 } } };
  const found = await s.call("POST", `${F}/query`, key, query);
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.deepEqual(
    found.body.hits.map((hit: any) => hit.id),
    [2, 3],
  );
  const retyped = await s.call("PATCH", "/indexes/f", key, {
    attributes: [{ name: "price", type: "int", filter_index: true }],
  });
  assert.equal(retyped.status, 400);
});

test("text attributes are searched by BM25 and fused with vectors", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const schema = {
    vectors: [{ name: "embedding", dims: 2, metric: "euclidean" }],
    attributes: [
      { name: "title", type: "text", k1: 0.9, b: 0.4 },
      { name: "body", type: "text" },
      { name: "tag", type: "string" },
    ],
  };
  const created = await s.call("POST", "/indexes", key, { name: "docs", schema });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const DOCS_IX = "/indexes/docs/branches/main";
  const documents = [
    {
      id: 1,
      vectors: { embedding: [0, 0] },
      attributes: { title: "Reset your password", body: "Open settings.", tag: "help" },
    },
    {
      id: 2,
      vectors: { embedding: [1, 0] },
      attributes: { title: "Billing", body: "Reset the password of a team member.", tag: "help" },
    },
    {
      id: 3,
      vectors: { embedding: [2, 0] },
      attributes: { title: "Invoices", body: "Download invoices.", tag: "news" },
    },
  ];
  assert.equal((await s.call("POST", `${DOCS_IX}/documents`, key, { documents })).status, 200);

  const search = (body: object) => s.call("POST", `${DOCS_IX}/search`, key, body);
  const found = await search({
    query: "reset password",
    boosts: { title: 3 },
    highlight: ["title"],
  });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.deepEqual(
    found.body.hits.map((hit: any) => hit.id),
    [1, 2],
  );
  assert.ok(found.body.hits[0].score > found.body.hits[1].score);
  assert.deepEqual(found.body.hits[0].highlights.title, {
    text: "Reset your password",
    marks: [
      [0, 5],
      [11, 19],
    ],
  });
  const typo = await search({ query: "pasword", fuzzy: 1 });
  assert.deepEqual(
    typo.body.hits.map((hit: any) => hit.id),
    [1, 2],
  );
  const phrase = await search({
    query: "password",
    filter: { and: [{ body: { phrase: "team member" } }, { tag: { eq: "help" } }] },
  });
  assert.deepEqual(
    phrase.body.hits.map((hit: any) => hit.id),
    [2],
  );

  const fused = await s.call("POST", `${DOCS_IX}/hybrid`, key, {
    searches: {
      meaning: { vector: { column: "embedding", value: [2, 0] }, topK: 3 },
      words: { query: "invoices", topK: 3 },
    },
    topK: 2,
    fuse: { weights: { words: 2 } },
  });
  assert.equal(fused.status, 200, JSON.stringify(fused.body));
  assert.equal(fused.body.hits[0].id, 3);
  assert.deepEqual(fused.body.hits[0].ranks, { meaning: 1, words: 1 });
  assert.ok(Math.abs(fused.body.hits[0].score - 3 / 61) < 1e-6);

  // Two text searches, one per field, summed: BM25 over title and body.
  const summed = await s.call("POST", `${DOCS_IX}/hybrid`, key, {
    searches: {
      title: { query: "password", fields: ["title"], topK: 3 },
      body: { query: "password", fields: ["body"], topK: 3 },
    },
    rank: { sum: [{ search: "title" }, { search: "body" }] },
  });
  assert.equal(summed.status, 200, JSON.stringify(summed.body));
  for (const hit of summed.body.hits) {
    const { title = 0, body = 0 } = hit.scores;
    assert.ok(Math.abs(hit.score - (title + body)) < 1e-4);
  }

  const pathOf = async (answer: Promise<{ status: number; body: any }>) => {
    const { status, body } = await answer;
    assert.equal(status, 400, JSON.stringify(body));
    return body.path;
  };
  assert.equal(await pathOf(search({ query: "x", fields: ["tag"] })), "fields[0]");
  assert.equal(
    await pathOf(search({ query: "x", fields: ["title"], boosts: { body: 2 } })),
    "boosts.body",
  );
  assert.equal(await pathOf(search({ query: "x", highlight: ["tag"] })), "highlight[0]");
  assert.equal(
    await pathOf(search({ query: "x", filter: { or: [{ body: { phrase: "a b" } }] } })),
    "filter.or[0].body.phrase",
  );
  assert.equal(
    await pathOf(search({ query: "x", filter: { body: { eq: "a" } } })),
    "filter.body.eq",
  );
  assert.equal(
    await pathOf(
      s.call("POST", `${DOCS_IX}/query`, key, {
        vector: { column: "embedding", value: [0, 0] },
        filter: { body: { phrase: "a" } },
      }),
    ),
    "filter.body.phrase",
  );
  assert.equal(
    await pathOf(
      s.call("POST", `${DOCS_IX}/hybrid`, key, {
        searches: { words: { query: "x", fields: ["nope"] } },
      }),
    ),
    "searches.words.fields[0]",
  );
  assert.equal(
    await pathOf(
      s.call("POST", `${DOCS_IX}/hybrid`, key, {
        searches: { words: { query: "x" } },
        rank: {
          sum: [{ search: "words" }, { decay: { of: { attribute: "tag" }, origin: 0, scale: 1 } }],
        },
      }),
    ),
    "rank.sum[1].decay.of.attribute",
  );
  assert.equal(
    (
      await s.call("POST", "/indexes", key, {
        name: "plain",
        schema: { attributes: [{ name: "t", type: "string", k1: 1 }] },
      })
    ).status,
    400,
  );

  // A text-only index takes documents without vectors.
  const words = await s.call("POST", "/indexes", key, {
    name: "words",
    schema: { attributes: [{ name: "text", type: "text" }] },
  });
  assert.equal(words.status, 201, JSON.stringify(words.body));
  const W = "/indexes/words/branches/main";
  const wrote = await s.call("POST", `${W}/documents`, key, {
    documents: [{ id: "a", attributes: { text: "hello world" } }],
  });
  assert.equal(wrote.status, 200, JSON.stringify(wrote.body));
  const hello = await s.call("POST", `${W}/search`, key, { query: "hello" });
  assert.deepEqual(
    hello.body.hits.map((hit: any) => hit.id),
    ["a"],
  );
});

test(
  "a branch goes back to an older version, forks from one, and is collected",
  { skip },
  async () => {
    const { s, key } = await made();
    await s.call("POST", `${MAIN}/documents`, key, { documents: DOCS.slice(0, 1) });
    await s.call("POST", `${MAIN}/documents`, key, { documents: DOCS.slice(1) });
    const versions = await s.call("GET", `${MAIN}/versions`, key);
    assert.equal(versions.status, 200, JSON.stringify(versions.body));
    assert.deepEqual(
      versions.body.map((v: any) => v.rows),
      [3, 1, 0],
    );
    assert.ok(!Number.isNaN(Date.parse(versions.body[0].time)));
    const one = versions.body[1].version;
    const page = await s.call(
      "GET",
      `${MAIN}/versions?limit=1&after=${versions.body[0].version}`,
      key,
    );
    assert.deepEqual(page.body, [versions.body[1]]);
    const ids = async (branch: string) =>
      (await s.call("POST", `${branch}/query`, key, near())).body.hits.map((hit: any) => hit.id);

    const fork = await s.call("POST", `${IX}/branches`, key, { name: "past", at: one });
    assert.equal(fork.status, 201, JSON.stringify(fork.body));
    assert.deepEqual(await ids(`${IX}/branches/past`), [1]);
    const bad = await s.call("POST", `${IX}/branches`, key, { name: "x", at: "nope" });
    assert.equal(bad.status, 400);

    const restored = await s.call("POST", `${MAIN}/restore`, key, { version: one });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.rows, 1);
    assert.deepEqual(await ids(MAIN), [1]);
    const after = await s.call("GET", `${MAIN}/versions`, key);
    assert.equal(after.body[0].version, restored.body.version);
    assert.equal(after.body.length, 4);
    const unknown = await s.call("POST", `${MAIN}/restore`, key, { version: "f".repeat(64) });
    assert.equal(unknown.status, 404);

    const updated = await s.call("PATCH", IX, key, { retention_days: 0 });
    assert.equal(updated.body.retention_days, 0);
    const tooOld = await s.call("POST", `${MAIN}/restore`, key, {
      version: versions.body[2].version,
    });
    assert.equal(tooOld.status, 400);

    const collect = await s.call("POST", `${IX}/collect`, key);
    assert.equal(collect.status, 202, JSON.stringify(collect.body));
    assert.deepEqual([collect.body.kind, collect.body.branch], ["collect", null]);
    const operation = `${IX}/operations/${collect.body.id}`;
    for (let tries = 0; (await s.call("GET", operation, key)).body.status === "running"; tries++) {
      assert.ok(tries < 100, "the collection never finished");
      await sleep(20);
    }
    assert.equal((await s.call("GET", operation, key)).body.status, "done");
    assert.deepEqual(await ids(MAIN), [1]);
    const cleared = await s.call("PATCH", IX, key, { retention_days: null });
    assert.equal(cleared.body.retention_days, null);
    const keepAll = await s.call("POST", `${IX}/collect`, key);
    assert.equal(keepAll.status, 202, JSON.stringify(keepAll.body));
  },
);

test("an export comes out as Parquet when asked", { skip }, async () => {
  const { s, key } = await made();
  await s.call("POST", `${MAIN}/documents`, key, { documents: DOCS });
  const parquet = await s.call("GET", `${MAIN}/export?format=parquet`, key);
  assert.equal(parquet.status, 200);
  assert.equal(parquet.headers.get("content-type"), "application/vnd.apache.parquet");
  assert.ok(String(parquet.body).startsWith("PAR1"));
  const ndjson = await s.call("GET", `${MAIN}/export`, key);
  assert.equal(ndjson.headers.get("content-type"), "application/x-ndjson");
  assert.equal((await s.call("GET", `${MAIN}/export?format=csv`, key)).status, 400);
});

test("only ids that were there are counted and billed as deleted", { skip }, async () => {
  const { s, key } = await made();
  await s.call("POST", `${MAIN}/documents`, key, { documents: DOCS });
  const deleted = await s.call("POST", `${MAIN}/documents/delete`, key, {
    ids: [1, 999, "zzz"],
    returnAffectedIds: true,
  });
  assert.deepEqual(deleted.body, { count: 1, deleted_ids: [1], billing: { deletes: 1 } });
  const none = await s.call("POST", `${MAIN}/documents/delete`, key, { ids: [1] });
  assert.deepEqual(none.body, { count: 0, billing: {} });
  const written = await s.call("POST", `${MAIN}/write`, key, { deletes: ["two", 998] });
  assert.equal(written.body.deleted, 1, JSON.stringify(written.body));
});

test("a body field the API does not know is refused by name", { skip }, async () => {
  const { s, key } = await made();
  const refused = await s.call("POST", `${MAIN}/documents/delete`, key, { ids: [1], idz: [2] });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /idz/);
  const write = await s.call("POST", `${MAIN}/write`, key, { deletes: [1], upsert: [] });
  assert.equal(write.status, 400);
  assert.match(write.body.error, /upsert/);
});
