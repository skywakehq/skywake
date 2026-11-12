import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { Skywake, SkywakeError } from "../dist/index.js";

interface Seen {
  method: string;
  url: string;
  body: any;
}

/** A fake API that records each request and answers with `answer`. */
async function fake(answer: (seen: Seen, response: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      const one = {
        method: request.method!,
        url: request.url!,
        body: text ? JSON.parse(text) : null,
      };
      seen.push(one);
      answer(one, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    sky: new Skywake({ url: `http://127.0.0.1:${port}`, key: "k", backoffMs: 1 }),
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body === undefined ? "" : JSON.stringify(body));
};

test("an upsert is sent 1000 documents at a time, to the branch picked", async (t) => {
  const api = await fake((seen, response) =>
    json(response, 200, { count: seen.body.documents.length }),
  );
  t.after(api.close);
  const docs = Array.from({ length: 2500 }, (_, id) => ({ id, vectors: { v: [id, 0] } }));
  const count = await api.sky.index("prod/products").at("agents/try").upsert(docs);
  assert.equal(count, 2500);
  assert.deepEqual(
    api.seen.map((seen) => [seen.method, seen.url, seen.body.documents.length]),
    [
      ["POST", "/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents", 1000],
      ["POST", "/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents", 1000],
      ["POST", "/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents", 500],
    ],
  );
});

const performance = { server_ms: 3, cache_temperature: "warm", cache_hit_ratio: 0.5 };

test("a query sends readable JSON and gives the hits", async (t) => {
  const hits = [{ id: "a", distance: 0.1, attributes: { tag: "billing" } }];
  const billing = { queries: 1 };
  const api = await fake((_, response) => json(response, 200, { hits, performance, billing }));
  t.after(api.close);
  const query = {
    vector: { column: "embedding", value: [0.1, 0.2] },
    topK: 5,
    recall: 0.99,
    probe: 32,
    filter: { and: [{ id: { in: ["a", 2] } }, { price: { lt: 10 } }] },
    exclude: ["body"],
    per: { attributes: ["tag"], limit: 2 },
    consistency: "eventual" as const,
  };
  const found = await api.sky.index("products").query(query);
  assert.deepEqual(found, hits);
  assert.deepEqual(found.performance, performance);
  assert.deepEqual(found.billing, billing);
  assert.equal(api.seen[0]!.url, "/v1/indexes/products/branches/main/query");
  assert.deepEqual(api.seen[0]!.body, query);
});

test("a search and a hybrid query go to their routes", async (t) => {
  const hits = [{ id: 1, score: 2.5, attributes: {}, highlights: {} }];
  const api = await fake((_, response) => json(response, 200, { hits }));
  t.after(api.close);
  const index = api.sky.index("docs");
  const search = {
    query: "reset password",
    topK: 3,
    boosts: { title: 2 },
    filter: {
      and: [{ body: { phrase: "reset password" } }, { title: { contains_any_token: "reset" } }],
    },
    highlight: ["body"],
  };
  assert.deepEqual(await index.search(search), hits);
  assert.equal(api.seen[0]!.url, "/v1/indexes/docs/branches/main/search");
  assert.deepEqual(api.seen[0]!.body, search);
  const hybrid = {
    searches: {
      meaning: { vector: { column: "embedding", value: [0.1] }, topK: 50 },
      words: { query: "reset", topK: 50 },
    },
    topK: 5,
    fuse: { k: 60, weights: { words: 2 } },
  };
  assert.deepEqual(await index.hybrid(hybrid), hits);
  assert.equal(api.seen[1]!.url, "/v1/indexes/docs/branches/main/hybrid");
  assert.deepEqual(api.seen[1]!.body, hybrid);
});

test("text vectors and rerank are sent as given, with the rerank scores back", async (t) => {
  const hits = [{ id: 2, distance: 0.3, attributes: {}, rerank_score: 0.9 }];
  const api = await fake((seen, response) =>
    json(response, 200, seen.url.endsWith("/documents") ? { count: 1 } : { hits }),
  );
  t.after(api.close);
  const index = api.sky.index("docs");
  const documents = [{ id: 1, vectors: { embedding: "a cat sleeps" } }];
  assert.equal(await index.upsert(documents), 1);
  assert.deepEqual(api.seen[0]!.body, { documents });
  const query = {
    vector: { column: "embedding", value: "kitten" },
    topK: 50,
    rerank: { model: "rerank-v3.5", field: "body", topN: 5 },
  };
  const found = await index.query(query);
  assert.equal(found[0]!.rerank_score, 0.9);
  assert.deepEqual(api.seen[1]!.body, query);
});

test("a bad field comes back with its JSON path", async (t) => {
  const api = await fake((_, response) =>
    json(response, 400, {
      error: "filter.price.lt: must be number",
      code: "invalid",
      request_id: "req-1",
      path: "filter.price.lt",
    }),
  );
  t.after(api.close);
  const query = { vector: { column: "v", value: [0] }, filter: { price: { lt: "x" } } };
  await assert.rejects(
    api.sky.index("products").query(query),
    (error: SkywakeError) =>
      error.status === 400 && error.code === "invalid" && error.path === "filter.price.lt",
  );
  assert.equal(api.seen.length, 1, "a 4xx is not retried");
});

test("fork, stats, build and branch delete go to the right routes", async (t) => {
  const api = await fake((seen, response) => {
    if (seen.method === "GET")
      return json(response, 200, { name: "x", forked_from: "main", created: "", stats: null });
    if (seen.method === "DELETE") return json(response, 204, undefined);
    if (seen.url.endsWith("/build") || seen.url.endsWith("/warm"))
      return json(response, 202, { id: "op_1", status: "running" });
    if (seen.url.endsWith("/recall")) return json(response, 200, { recall: 1 });
    if (seen.url.endsWith("/merge")) return json(response, 200, { rows: 2 });
    json(response, 201, { name: seen.body.name, forked_from: seen.body.from, created: "" });
  });
  t.after(api.close);
  const main = api.sky.index("products");
  const fork = await main.fork("agents/x");
  assert.equal(fork.branch, "agents/x");
  assert.equal(await fork.stats(), null);
  assert.equal((await fork.build()).id, "op_1");
  await fork.warm();
  await fork.operation("op_1");
  assert.equal((await fork.recall({ queries: 5 })).recall, 1);
  assert.equal(await main.merge("agents/x"), 2);
  assert.deepEqual(api.seen.at(-1)!.body, { from: "agents/x" });
  await fork.deleteBranch();
  assert.deepEqual(
    api.seen.map((seen) => `${seen.method} ${seen.url}`),
    [
      "POST /v1/indexes/products/branches",
      "GET /v1/indexes/products/branches/agents%2Fx",
      "POST /v1/indexes/products/branches/agents%2Fx/build",
      "POST /v1/indexes/products/branches/agents%2Fx/warm",
      "GET /v1/indexes/products/operations/op_1",
      "POST /v1/indexes/products/branches/agents%2Fx/recall",
      "POST /v1/indexes/products/branches/main/merge",
      "DELETE /v1/indexes/products/branches/agents%2Fx",
    ],
  );
  assert.deepEqual(api.seen[0]!.body, { name: "agents/x", from: "main" });
});

test("indexes are made, paged, read and deleted", async (t) => {
  const names = Array.from({ length: 1001 }, (_, i) => `i${String(i).padStart(4, "0")}`);
  const api = await fake((seen, response) => {
    const url = new URL(seen.url, "http://x");
    if (seen.method === "POST") return json(response, 201, { ...seen.body, created: "" });
    if (seen.method === "DELETE") return json(response, 204, undefined);
    if (url.pathname !== "/v1/indexes") return json(response, 200, { name: "a", stats: null });
    const after = url.searchParams.get("after");
    const start = after ? names.indexOf(after) + 1 : 0;
    json(
      response,
      200,
      names.slice(start, start + 1000).map((name) => ({ name })),
    );
  });
  t.after(api.close);
  const schema = {
    vectors: [{ name: "v", dims: 3 }],
    attributes: [
      { name: "body", type: "text" as const, language: "french" as const, stopwords: true },
    ],
  };
  const made = await api.sky.indexes.create("prod/a", schema);
  assert.equal(made.name, "prod/a");
  assert.deepEqual(api.seen[0]!.body, { name: "prod/a", schema });

  const all = [];
  for await (const index of api.sky.indexes.all()) all.push(index.name);
  assert.deepEqual(all, names);
  assert.equal((await api.sky.indexes.get("prod/a")).name, "a");
  const update = {
    read_only: true,
    retention_days: 7,
    attributes: [{ name: "lang", type: "string" as const }],
  };
  await api.sky.indexes.update("prod/a", update);
  assert.deepEqual(api.seen.at(-1)!.body, update);
  await api.sky.indexes.delete("prod/a");
  assert.deepEqual(
    api.seen.slice(1).map((seen) => `${seen.method} ${seen.url}`),
    [
      "GET /v1/indexes?limit=1000",
      "GET /v1/indexes?limit=1000&after=i0999",
      "GET /v1/indexes/prod%2Fa",
      "PATCH /v1/indexes/prod%2Fa",
      "DELETE /v1/indexes/prod%2Fa",
    ],
  );
});

test("an index is pinned when made, repinned, unpinned, and says where it is pinned", async (t) => {
  const pinning = { replicas: [{ server: "api-1", warm: true, in_flight: 2 }] };
  const api = await fake((seen, response) =>
    json(response, 200, { name: "a", pinned: { replicas: 1 }, pinning }),
  );
  t.after(api.close);
  const schema = { vectors: [{ name: "v", dims: 3 }] };
  await api.sky.indexes.create("a", schema, { pinned: { replicas: 2 } });
  assert.deepEqual(api.seen[0]!.body, { name: "a", schema, pinned: { replicas: 2 } });
  await api.sky.indexes.update("a", { pinned: { replicas: 3 } });
  assert.deepEqual(api.seen[1]!.body, { pinned: { replicas: 3 } });
  await api.sky.indexes.update("a", { pinned: null });
  assert.deepEqual(api.seen[2]!.body, { pinned: null });
  const info = await api.sky.indexes.get("a");
  assert.deepEqual(info.pinned, { replicas: 1 });
  assert.deepEqual(info.pinning, pinning);
});

test("documents come a page at a time, by cursor, and one by id", async (t) => {
  const doc = (id: number | string) => ({ id, vectors: { v: [0] }, attributes: {} });
  const api = await fake((seen, response) => {
    if (seen.url.includes("/documents/")) return json(response, 200, doc("a/b"));
    if (seen.url.includes("/usage")) return json(response, 200, { days: [] });
    const cursor = new URL(seen.url, "http://x").searchParams.get("cursor");
    return json(
      response,
      200,
      cursor ? { documents: [doc(3)], next: null } : { documents: [doc(1), doc(2)], next: "c1" },
    );
  });
  t.after(api.close);
  const index = api.sky.index("products");
  const all = [];
  for await (const one of index.allDocuments()) all.push(one.id);
  assert.deepEqual(all, [1, 2, 3]);
  assert.equal((await index.get("a/b")).id, "a/b");
  assert.deepEqual(await api.sky.indexes.usage("products", 7), []);
  assert.deepEqual(
    api.seen.map((seen) => seen.url),
    [
      "/v1/indexes/products/branches/main/documents?limit=1000",
      "/v1/indexes/products/branches/main/documents?limit=1000&cursor=c1",
      "/v1/indexes/products/branches/main/documents/a%2Fb",
      "/v1/indexes/products/usage?days=7",
    ],
  );
});

test("writes, orders, aggregates, multi-queries, exports and copies", async (t) => {
  const api = await fake((seen, response) => {
    const path = new URL(seen.url, "http://x").pathname;
    if (path.endsWith("/write")) {
      return json(response, 200, { upserted: 0, patched: 1, deleted: 2 });
    }
    if (path.endsWith("/order")) {
      return json(response, 200, { rows: [{ id: 1, attributes: {} }], performance });
    }
    if (path.endsWith("/aggregate")) {
      return json(response, 200, { groups: [{ key: {}, values: { n: 2 } }], performance });
    }
    if (path.endsWith("/multi"))
      return json(response, 200, { results: [{ order: [] }], performance });
    if (path.endsWith("/copy")) return json(response, 201, { name: seen.body.name });
    // Lines split across chunks still read whole.
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.write('{"id":1,"vectors":{},"attributes":{}}\n{"id":"t');
    response.end('wo","vectors":{},"attributes":{}}\n');
  });
  t.after(api.close);
  const index = api.sky.index("prod/a").at("dev");
  assert.equal(await index.patch([{ id: 1, attributes: { n: null } }]), 1);
  assert.equal(await index.deleteBy({ tag: { glob: "old-*" } }), 2);
  assert.deepEqual(await index.order({ by: "n", descending: true }), [{ id: 1, attributes: {} }]);
  const groups = await index.aggregate({ measures: { n: ["count"] } });
  assert.deepEqual(groups[0]!.values, { n: 2 });
  const results = await index.multi([{ order: { by: "id" } }], { consistency: "eventual" });
  assert.deepEqual(results, [{ order: [] }]);
  assert.equal(results.performance.cache_temperature, "warm");
  const ids = [];
  for await (const doc of index.export()) ids.push(doc.id);
  assert.deepEqual(ids, [1, "two"]);
  assert.equal((await index.copy("prod/b")).name, "prod/b");
  assert.deepEqual(
    api.seen.map((seen) => `${seen.method} ${seen.url}`),
    [
      "POST /v1/indexes/prod%2Fa/branches/dev/write",
      "POST /v1/indexes/prod%2Fa/branches/dev/write",
      "POST /v1/indexes/prod%2Fa/branches/dev/order",
      "POST /v1/indexes/prod%2Fa/branches/dev/aggregate",
      "POST /v1/indexes/prod%2Fa/branches/dev/multi",
      "GET /v1/indexes/prod%2Fa/branches/dev/export",
      "POST /v1/indexes/prod%2Fa/copy",
    ],
  );
  assert.deepEqual(api.seen[1]!.body, { deleteBy: { tag: { glob: "old-*" } } });
  assert.deepEqual(api.seen.at(-1)!.body, { name: "prod/b", branch: "dev" });
});

test("a write asks for the ids it changed; an index may take uuid ids", async (t) => {
  const answer = { upserted: 1, patched: 0, deleted: 1, upserted_ids: ["a"], deleted_ids: [2] };
  const api = await fake((seen, response) =>
    seen.url.endsWith("/write")
      ? json(response, 200, answer)
      : json(response, 201, { ...seen.body, created: "" }),
  );
  t.after(api.close);
  const write = { upserts: [{ id: "a", vectors: { v: [0] } }], deletes: [2] };
  const counts = await api.sky.index("a").write({ ...write, returnAffectedIds: true });
  assert.deepEqual(counts.upserted_ids, ["a"]);
  assert.deepEqual(api.seen[0]!.body, { ...write, returnAffectedIds: true });
  const schema = { vectors: [{ name: "v", dims: 1 }], attributes: [], id: "uuid" as const };
  await api.sky.indexes.create("b", schema);
  assert.deepEqual(api.seen[1]!.body, { name: "b", schema });
});

test("rank sends the score and gives the hits with performance", async (t) => {
  const hits = [{ id: 1, score: 2, attributes: {} }];
  const api = await fake((_, response) =>
    json(response, 200, { hits, performance, billing: { queries: 1 } }),
  );
  t.after(api.close);
  const score = { dot: { attribute: "terms", indices: [2], values: [1] } };
  const ranked = await api.sky.index("docs").rank({ score, topK: 3 });
  assert.deepEqual([...ranked], hits);
  assert.equal(ranked.billing.queries, 1);
  assert.equal(api.seen[0]!.url, "/v1/indexes/docs/branches/main/rank");
  assert.deepEqual(api.seen[0]!.body, { score, topK: 3 });
});

test("versions, restore, fork at, collect and a Parquet export go to the right routes", async (t) => {
  const version = "a".repeat(64);
  const api = await fake((seen, response) => {
    if (seen.url.includes("/versions"))
      return json(response, 200, [{ version, time: "", rows: 1 }]);
    if (seen.url.endsWith("/restore")) return json(response, 200, { version, time: "", rows: 1 });
    if (seen.url.endsWith("/collect")) return json(response, 202, { id: "op_2", kind: "collect" });
    if (seen.url.includes("/export")) {
      response.writeHead(200, { "content-type": "application/vnd.apache.parquet" });
      return response.end("PAR1");
    }
    json(response, 201, { name: seen.body.name, forked_from: seen.body.from, created: "" });
  });
  t.after(api.close);
  const main = api.sky.index("products");
  assert.equal((await main.versions({ limit: 5, after: version }))[0]!.rows, 1);
  assert.equal((await main.restore(version)).version, version);
  assert.equal((await main.fork("past", version)).branch, "past");
  assert.equal((await main.collect()).id, "op_2");
  const parts: Uint8Array[] = [];
  for await (const part of main.exportParquet()) parts.push(part);
  assert.equal(Buffer.concat(parts).toString(), "PAR1");
  assert.deepEqual(
    api.seen.map((seen) => `${seen.method} ${seen.url}`),
    [
      `GET /v1/indexes/products/branches/main/versions?limit=5&after=${version}`,
      "POST /v1/indexes/products/branches/main/restore",
      "POST /v1/indexes/products/branches",
      "POST /v1/indexes/products/collect",
      "GET /v1/indexes/products/branches/main/export?format=parquet",
    ],
  );
  assert.deepEqual(api.seen[1]!.body, { version });
  assert.deepEqual(api.seen[2]!.body, { name: "past", from: "main", at: version });
});

test("create with `ifMissing` gives the index that is there instead of failing", async (t) => {
  const api = await fake((_, response) =>
    json(response, 409, { error: "exists", code: "conflict", request_id: "r" }),
  );
  t.after(api.close);
  const schema = { vectors: [{ name: "v", dims: 3 }] };
  const found = await api.sky.indexes.create("docs", schema, { ifMissing: true, shards: 2 });
  assert.equal(found.name, "docs");
  assert.deepEqual(api.seen[0]!.body, { name: "docs", schema, shards: 2 });
  await assert.rejects(api.sky.indexes.create("docs", schema), { status: 409 });
});
