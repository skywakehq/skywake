import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";

import { and, eq } from "drizzle-orm";

import { audit } from "../src/db/schema.ts";

import { CompatClient } from "./compat-client.ts";
import { server, skip } from "./helpers.ts";

async function client(overrides: Parameters<typeof server>[0] = {}) {
  const s = await server(overrides);
  const { id, key } = await s.org();
  const api = new CompatClient((path, init) => s.app.request(path, init), key);
  return { s, api, org: id, key };
}

const ROWS = [
  { id: 1, vector: [0, 0], title: "billing refunds", tag: "billing", price: 5 },
  { id: 2, vector: [1, 0], title: "billing invoices", tag: "billing", price: 20 },
  { id: 3, vector: [2, 0], title: "search tuning", tag: "search", price: 7 },
];
const SCHEMA = { title: { type: "string", full_text_search: true } } as const;

async function filled() {
  const made = await client();
  const ns = made.api.namespace("docs");
  const written = await ns.write({
    upsert_rows: ROWS,
    distance_metric: "euclidean_squared",
    schema: SCHEMA,
  });
  assert.equal(written.rows_affected, 3);
  return { ...made, ns };
}

test("a namespace is written, queried and described", { skip }, async () => {
  const { api, ns } = await filled();

  const near = await ns.query({
    rank_by: ["vector", "ANN", [0.1, 0]],
    top_k: 2,
    include_attributes: ["tag"],
  });
  assert.deepEqual(
    near.rows!.map((row) => row.id),
    [1, 2],
  );
  assert.equal(near.rows![0]!.tag, "billing");
  assert.equal(typeof near.rows![0]!.$dist, "number");
  assert.ok(near.performance && near.billing);

  const filtered = await ns.query({
    rank_by: ["vector", "kNN", [0, 0]],
    top_k: 10,
    filters: [
      "And",
      [
        ["tag", "Eq", "billing"],
        ["price", "Gte", 10],
      ],
    ],
  });
  assert.deepEqual(
    filtered.rows!.map((row) => row.id),
    [2],
  );

  const text = await ns.query({ rank_by: ["title", "BM25", "refunds"], top_k: 5 });
  assert.deepEqual(
    text.rows!.map((row) => row.id),
    [1],
  );

  const ordered = await ns.query({ rank_by: ["price", "desc"], top_k: 2 });
  assert.deepEqual(
    ordered.rows!.map((row) => row.id),
    [2, 3],
  );

  const counted = await ns.query({ aggregate_by: { n: ["Count"] }, group_by: ["tag"] });
  const groups = Object.fromEntries(counted.aggregation_groups!.map((g: any) => [g.tag, g.n]));
  assert.deepEqual(groups, { billing: 2, search: 1 });

  const both = await ns.multiQuery({
    queries: [
      { rank_by: ["vector", "ANN", [2, 0]], top_k: 3 },
      { rank_by: ["title", "BM25", "billing"], top_k: 3 },
    ],
  });
  assert.equal(both.results.length, 2);

  const meta = await ns.metadata();
  assert.equal(meta.approx_row_count, 3);
  assert.equal(meta.schema.title!.type, "string");
  assert.equal(meta.schema.vector!.type, "[2]f32");

  assert.equal(await ns.exists(), true);
  assert.equal(await api.namespace("nope").exists(), false);
  const listed = [];
  for await (const summary of api.namespaces({ prefix: "do" })) listed.push(summary.id);
  assert.deepEqual(listed, ["docs"]);
});

test("calls are in the audit log", { skip }, async () => {
  const { s, org } = await filled();
  await s.services.audit.flush();
  const rows = await s.db
    .select()
    .from(audit)
    .where(and(eq(audit.org, org), eq(audit.action, "compat.write")));
  assert.equal(rows.length, 1);
  assert.equal((rows[0]!.resource as any).namespace, "docs");
});

test("patches, deletes and conditional writes", { skip }, async () => {
  const { s, key, ns } = await filled();
  await ns.write({ patch_rows: [{ id: 3, tag: "billing" }] });
  await ns.write({ deletes: [1] });
  // Missing ids count in the answer, but are not billed.
  const gone = await ns.write({ deletes: [998, 999] });
  assert.equal(gone.rows_deleted, 2);
  const usage = await s.call("GET", "/indexes/docs/usage?days=1", key);
  assert.equal(usage.body.days[0].deletes, 1, JSON.stringify(usage.body));
  const kept = await ns.query({
    rank_by: ["price", "asc"],
    top_k: 10,
    include_attributes: ["tag"],
  });
  assert.deepEqual(
    kept.rows!.map((row) => [row.id, row.tag]),
    [
      [3, "billing"],
      [2, "billing"],
    ],
  );

  const removed = await ns.write({ delete_by_filter: ["price", "Lt", 10] });
  assert.equal(removed.rows_deleted, 1);

  const skipped = await ns.write({
    upsert_rows: [{ id: 2, vector: [5, 5], price: 1 }],
    upsert_condition: ["price", "Gt", 100],
  });
  assert.equal(skipped.rows_upserted, 0);
});

test("every row can be exported by paging on id", { skip }, async () => {
  const { ns } = await filled();
  const seen: unknown[] = [];
  let last: number | undefined;
  for (;;) {
    const page = await ns.query({
      rank_by: ["id", "asc"],
      top_k: 2,
      ...(last === undefined ? {} : { filters: ["id", "Gt", last] }),
    });
    if (page.rows!.length === 0) break;
    seen.push(...page.rows!.map((row) => row.id));
    last = page.rows!.at(-1)!.id as number;
  }
  assert.deepEqual(seen, [1, 2, 3]);
});

test("branches and copies are new namespaces", { skip }, async () => {
  const { s, api, ns } = await filled();
  await api.namespace("fork").branchFrom({ source_namespace: "docs" });
  await api.namespace("fork").write({ deletes: [1, 2] });
  assert.equal((await api.namespace("fork").metadata()).approx_row_count, 1);
  assert.equal((await ns.metadata()).approx_row_count, 3);

  await api.namespace("copy").copyFrom({ source_namespace: "docs" });
  assert.equal((await api.namespace("copy").metadata()).approx_row_count, 3);

  const { token } = await api.namespace("later").startCopyFrom({ source_namespace: "docs" });
  let polled = await api.namespace("later").pollCopyFrom(token);
  for (let i = 0; polled.status === "running" && i < 50; i++) {
    await sleep(100);
    polled = await api.namespace("later").pollCopyFrom(token);
  }
  assert.equal(polled.status, "finished");
  assert.equal(
    (polled.result as { success?: { rows_affected: number } }).success?.rows_affected,
    3,
  );
  assert.equal((await api.namespace("later").metadata()).approx_row_count, 3);
  // Another organization holding the token learns nothing.
  const outsider = await s.org();
  const peek = await s.app.request(`/compat/v1/namespaces/later/operations/${token}`, {
    headers: { authorization: `Bearer ${outsider.key}` },
  });
  assert.equal(peek.status, 404);

  // The source goes; its branch lives on, and its name can be used again.
  await ns.deleteAll();
  assert.equal(await ns.exists(), false);
  assert.equal((await api.namespace("fork").metadata()).approx_row_count, 1);
  await ns.write({
    upsert_rows: [{ id: 9, vector: [0, 0] }],
    distance_metric: "euclidean_squared",
  });
  assert.equal((await ns.metadata()).approx_row_count, 1);
  await api.namespace("fork").deleteAll();
});

test("schema, metadata changes, warming and recall", { skip }, async () => {
  const { ns } = await filled();
  const schema = await ns.updateSchema({ schema: { kind: { type: "string", filterable: true } } });
  assert.equal(schema.kind!.type, "string");
  const meta = await ns.updateMetadata({ read_only: true });
  assert.equal(meta.read_only, true);
  await assert.rejects(ns.write({ deletes: [1] }), (error: any) => error.status === 403);
  await ns.updateMetadata({ read_only: false });

  assert.equal((await ns.hintCacheWarm()).status, "ACCEPTED");
  const recall = await ns.recall({ num: 3, top_k: 2 });
  assert.ok(recall.avg_recall > 0);
  assert.ok((await ns.explainQuery({ rank_by: ["vector", "ANN", [0, 0]] })).plan_text);
});

test("errors come back in the client's shape", { skip }, async () => {
  const { api, s } = await client();
  const failed = await api
    .namespace("missing")
    .query({ rank_by: ["vector", "ANN", [0, 0]] })
    .catch((error: any) => error);
  assert.equal(failed.status, 404);
  assert.match(failed.message, /namespace `missing`/);
  const raw = await s.app.request("/compat/v2/namespaces/missing/query", {
    method: "POST",
    headers: { authorization: `Bearer ${(await s.org()).key}` },
    body: "{}",
  });
  assert.equal(raw.headers.get("x-should-retry"), "false");
  assert.equal(((await raw.json()) as any).status, "error");
});

test("a gzip body may not unpack past the body limit", { skip }, async () => {
  const s = await server();
  const send = (body: Uint8Array) =>
    s.app.request("/compat/v2/namespaces/docs/query", {
      method: "POST",
      headers: { "content-encoding": "gzip", "content-type": "application/json" },
      body: new Uint8Array(body),
    });
  // A few kilobytes that unpack to 2 MiB, twice the test server's limit.
  const bomb = await send(gzipSync(Buffer.alloc(2 * 1024 * 1024, " ")));
  assert.equal(bomb.status, 413);
  assert.equal(((await bomb.json()) as any).code, "too_large");
  const broken = await send(Buffer.from("not gzip"));
  assert.equal(broken.status, 400);
});

const ids = (result: { rows?: { id: unknown }[] }) => result.rows!.map((row) => row.id);

test("text options, filterable text, prefixes and id ranges in a search", { skip }, async () => {
  const { api } = await client();
  const ns = api.namespace("texts");
  await ns.write({
    upsert_rows: [
      { id: 1, title: "Running Shoes", body: "café crème", tags: ["New York", "sale"] },
      { id: 2, title: "running socks", body: "cafe noir", tags: ["new york"] },
      { id: 3, title: "Runner", body: "the runway", tags: ["Paris"] },
    ],
    schema: {
      title: { type: "string", filterable: true, full_text_search: { case_sensitive: true } },
      body: { type: "string", full_text_search: { ascii_folding: true } },
      tags: { type: "[]string", full_text_search: { tokenizer: "pre_tokenized_array" } },
    } as any,
  });
  const search = (rank_by: unknown, filters?: unknown) =>
    ns.query({ rank_by, filters, top_k: 10 } as any).then(ids);

  assert.deepEqual(await search(["title", "BM25", "Running"]), [1]);
  assert.deepEqual(await search(["title", "BM25", "Run"]), []);
  assert.deepEqual((await search(["body", "BM25", "cafe"])).sort(), [1, 2]);
  assert.deepEqual(await search(["tags", "BM25", "New York"]), [1]);
  assert.deepEqual(await search(["body", "BM25", "the run", { last_as_prefix: true }]), [3]);
  assert.deepEqual(
    await search(
      ["body", "BM25", "cafe"],
      ["body", "ContainsAllTokens", "noi", { last_as_prefix: true }],
    ),
    [2],
  );
  assert.deepEqual(await search(["body", "BM25", "cafe"], ["id", "Gt", 1]), [2]);
  assert.deepEqual(await search(["id", "asc"], ["title", "Eq", "Running Shoes"]), [1]);
  assert.deepEqual(await search([["title", "asc"]]), [3, 1, 2]);

  const schema = (await ns.schema()) as any;
  assert.equal(schema.title.filterable, true);
  assert.equal(schema.title.full_text_search.case_sensitive, true);
  assert.equal(schema.title.full_text_search.stemming, false);
  assert.equal(schema.tags.type, "[]string");
  assert.equal(schema.tags.full_text_search.tokenizer, "pre_tokenized_array");
});

test("nulls, fuzzy matches and many order keys", { skip }, async () => {
  const { api } = await client();
  const ns = api.namespace("filters");
  await ns.write({
    upsert_rows: [
      { id: 1, vector: [0, 0], name: "paris", n: 5, tag: "a", labels: ["x", "y"], price: 5 },
      { id: 2, vector: [1, 0], name: "parsi", tag: "a", labels: ["x"], price: 3 },
      { id: 3, vector: [2, 0], name: "london", n: 9, tag: "b", labels: ["y"], price: 3 },
      { id: 4, vector: [3, 0], name: "lisbon", n: 1, price: 9 },
    ],
  });
  const found = (filters: unknown, rank_by: unknown = ["id", "asc"]) =>
    ns.query({ rank_by, filters, top_k: 10 } as any).then(ids);

  assert.deepEqual(await found(["n", "Lt", 7]), [1, 2, 4]);
  assert.deepEqual(await found(["n", "Eq", null]), [2]);
  assert.deepEqual(await found(["n", "NotEq", null]), [1, 3, 4]);
  assert.deepEqual(await found(["name", "Fuzzy", "paris"]), [1]);
  const near = { max_edit_distance: [{ distance: 1, min_query_chars: 3 }] };
  assert.deepEqual(await found(["name", "Fuzzy", "paris", near]), [1, 2]);
  assert.deepEqual(
    await found(undefined, [
      ["price", "asc"],
      ["tag", "desc"],
    ]),
    [3, 2, 1, 4],
  );

  const scored = await found(undefined, [
    "Sum",
    [
      ["tag", "Eq", "b"],
      ["Product", 0.5, ["price", "Gt", 4]],
    ],
  ]);
  assert.equal(scored[0], 3);
  assert.deepEqual(scored.slice(1).sort(), [1, 4]);
  const cheap = await found(undefined, ["Decay", ["Attribute", "price"], { midpoint: 4 }]);
  assert.equal(cheap.at(-1), 4);
  const later = await found(undefined, ["Saturate", ["Attribute", "price"], { midpoint: "1s" }]);
  assert.equal(later[0], 4);

  const totals = await ns.query({
    aggregate_by: { n: ["Count"], tagged: ["Count", "tag"], total: ["Sum", "price"] },
  } as any);
  assert.deepEqual(totals.aggregations, { n: 4, tagged: 3, total: 20 });
  const each = await ns.query({
    aggregate_by: { n: ["Count"] },
    group_by: [{ label: ["ForEachUnique", "labels"] }],
  } as any);
  const byLabel = Object.fromEntries(each.aggregation_groups!.map((g: any) => [g.label, g.n]));
  assert.deepEqual(byLabel, { x: 2, y: 2 });
});

const EMBEDDINGS: Record<string, number[]> = {
  "a cat sleeps": [0, 0],
  "a dog barks": [1, 0],
  kitten: [0.1, 0],
  puppy: [1.1, 0],
};
const provider = createServer((request, response) => {
  let text = "";
  request.on("data", (chunk) => (text += chunk));
  request.on("end", () => {
    const body = JSON.parse(text);
    const data = (body.input as string[]).map((input, index) => ({
      index,
      embedding: body.output_dimension
        ? Array(body.output_dimension).fill(0)
        : body.model.startsWith("voyage-")
          ? Array(1024).fill(0)
          : (EMBEDDINGS[input] ?? [9, 9]),
    }));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data }));
  });
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
after(() => provider.close());
const EMBED = { url: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`, key: "k" };

test("embedded attributes, computed attributes, vectors in rows and drops", { skip }, async () => {
  const { api } = await client({ embed: EMBED });
  const ns = api.namespace("embedded");
  await ns.write({
    upsert_rows: [
      { id: 1, content: "a cat sleeps", tag: "pet" },
      { id: 2, content: "a dog barks", tag: "pet" },
    ],
    distance_metric: "euclidean_squared",
    schema: { content: { type: "string", embed: "tiny", full_text_search: true } } as any,
  });
  const schema = (await ns.schema()) as any;
  assert.equal(schema.embed_content.type, "[2]f32");
  assert.equal(schema.content.embed.model, "tiny");

  const near = await ns.query({
    rank_by: ["content", "ANN", ["Embed", "kitten"]],
    top_k: 2,
    include_attributes: ["embed_content"],
  } as any);
  assert.deepEqual(ids(near), [1, 2]);
  assert.deepEqual(near.rows![0]!.embed_content, [0, 0]);

  const computed = await ns.query({
    rank_by: ["$embed_content", "ANN", [0, 0]],
    top_k: 2,
    compute_attributes: {
      d: ["embed_content", "VectorDist", [1, 0]],
      s: ["content", "BM25", "dog"],
      h: ["Highlight", "content", { rank_fragments_by: ["$fragment", "BM25", "dog"] }],
      e: ["Embed", "puppy"],
    },
  } as any);
  const [cat, dog] = computed.rows as any[];
  assert.deepEqual([cat.d, dog.d], [1, 0]);
  assert.equal(cat.s, 0);
  assert.ok(dog.s > 0);
  assert.deepEqual(cat.h, []);
  assert.match(dog.h[0].text, /dog/);
  assert.deepEqual(cat.e, [1.1, 0]);

  await ns.write({ patch_rows: [{ id: 1, content: "a dog barks" }] });
  const moved = await ns.query({
    rank_by: ["id", "asc"],
    top_k: 2,
    include_attributes: true,
  } as any);
  assert.deepEqual(moved.rows![0]!.embed_content, [1, 0]);
  assert.equal(moved.rows![0]!.tag, "pet");

  const dropped = (await ns.updateSchema({ schema: { tag: { drop: true } } as any })) as any;
  assert.equal(dropped.tag, undefined);
  const after = await ns.query({ rank_by: ["id", "asc"], top_k: 2, include_attributes: true });
  assert.equal(after.rows![0]!.tag, undefined);
});

test("catalog models are sized without asking the provider", { skip }, async () => {
  const { api } = await client({ vendors: { voyage: { url: EMBED.url, key: "v" } } });
  const plain = api.namespace("catalog-plain");
  await plain.write({
    upsert_rows: [{ id: 1, content: "a cat sleeps" }],
    schema: { content: { type: "string", embed: "voyage/voyage-4-lite" } } as any,
  });
  assert.equal(((await plain.schema()) as any).embed_content.type, "[1024]f32");

  const small = api.namespace("catalog-small");
  await small.write({
    upsert_rows: [{ id: 1, content: "a cat sleeps" }],
    schema: {
      content: { type: "string", embed: { model: "voyage/voyage-4-lite", dims: 256 } },
    } as any,
  });
  const shown = (await small.schema()) as any;
  assert.equal(shown.embed_content.type, "[256]f32");
  assert.deepEqual(shown.content.embed, { model: "voyage/voyage-4-lite", dims: 256 });

  await assert.rejects(
    api.namespace("catalog-wrong").write({
      upsert_rows: [{ id: 1, content: "a cat" }],
      schema: {
        content: { type: "string", embed: { model: "voyage/voyage-4-lite", dims: 300 } },
      } as any,
    }),
    /256, 512, 1024, 2048/,
  );
});
