import assert from "node:assert/strict";
import { after, test } from "node:test";

import { decodeVectors } from "../src/v2/rows.ts";
import { fakeEmbedder } from "./fake-embed.ts";
import { server, skip, type Server } from "./helpers.ts";

const provider = await fakeEmbedder();
after(() => provider.server.close());
const embed = { url: provider.url };

type Body = unknown;

function client(s: Server, key: string, environment?: string) {
  return async (method: string, path: string, body?: Body, raw?: string) => {
    const headers: Record<string, string> = { authorization: `Bearer ${key}` };
    if (environment) headers["skywake-environment"] = environment;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (raw !== undefined) headers["content-type"] = "application/octet-stream";
    const response = await s.app.request(`/v2${path}`, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    let json: any = text;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, body: json };
  };
}

async function started(withModel = true) {
  const s = await server(withModel ? { embed, embedModel: "tiny" } : {});
  const { key } = await s.org();
  return { s, key, api: client(s, key, "prod") };
}

const ok = (done: { status: number; body: any }, status = 200) => {
  assert.equal(done.status, status, JSON.stringify(done.body));
  return done.body;
};

const PRODUCTS = [
  { id: 1, text: "red running shoe", price: 89, tags: ["sale"], color: "red" },
  { id: 2, text: "black coffee mug", price: 12, tags: ["kitchen"], color: "black" },
  { id: 3, text: "trail shoe for mud", price: 120, tags: ["sale", "outdoor"], color: "green" },
];

test("account routes: whoami, environments and keys", { skip }, async () => {
  const { s, key, api } = await started(false);
  assert.equal(ok(await api("GET", "/whoami")).environment, "prod");
  ok(await api("POST", "/environments", { name: "staging" }), 201);
  const envs = ok(await api("GET", "/environments"));
  assert.ok(envs.data.some((env: { name: string }) => env.name === "staging"));
  assert.equal(envs.next, null);
  const made = ok(
    await api("POST", "/keys", { name: "ci", role: "read", environment: "staging" }),
    201,
  );
  const listed = ok(await api("GET", "/keys"));
  const mine = listed.data.find((k: { id: string }) => k.id === made.id);
  assert.equal(mine.environment, "staging");
  assert.equal("namespaces" in mine, false);
  const paged = ok(await api("GET", "/keys?limit=1"));
  assert.equal(paged.data.length, 1);
  assert.ok(paged.next);
  ok(await api("DELETE", `/keys/${made.id}`), 204);
  assert.equal(ok(await client(s, key)("GET", "/whoami")).environment, null);
});

test(
  "the first upsert makes an index that searches by meaning and keywords",
  { skip },
  async () => {
    const { api } = await started();
    assert.deepEqual(ok(await api("POST", "/indexes/products/rows", PRODUCTS)), {
      ids: [1, 2, 3],
      count: 3,
    });
    const info = ok(await api("GET", "/indexes/products"));
    assert.equal(info.name, "products");
    assert.deepEqual(info.branches, ["main"]);
    const types = Object.fromEntries(info.schema.attributes.map((a: any) => [a.name, a.type]));
    assert.deepEqual(types, { text: "text", price: "number", tags: "strings", color: "text" });
    assert.equal(info.schema.vectors[0].embed.from, "text");

    const query = async (body: object) =>
      ok(await api("POST", "/indexes/products/query", body)).data;
    const auto = await query({ text: "shoe", limit: 2 });
    assert.deepEqual(auto.map((h: any) => h.id).sort(), [1, 3]);
    assert.equal(auto[0].price !== undefined, true);
    assert.equal(auto[0]._meaning, undefined);
    assert.deepEqual(
      (await query({ text: "coffee", mode: "keywords" })).map((h: any) => h.id),
      [2],
    );
    assert.equal((await query({ text: "coffee", mode: "meaning", limit: 1 }))[0].id, 2);
    const cheap = await query({ text: "shoe", filter: { price: { lt: 100 } } });
    assert.equal(cheap[0].id, 1);
    assert.ok(cheap.every((h: any) => h.price < 100));
    const onSale = await query({ filter: { tags: { contains: "sale" } }, sort: { price: "desc" } });
    assert.deepEqual(
      onSale.map((h: any) => h.id),
      [3, 1],
    );
    assert.deepEqual(
      (await query({ filter: { color: "black" } })).map((h: any) => h.id),
      [2],
    );
    const only = await query({ text: "mug", fields: ["price"] });
    assert.deepEqual(Object.keys(only[0]).sort(), ["id", "price", "score"]);
    const own = await query({ vector: [0, 1, 0, 0, 0.05], mode: "meaning", limit: 1 });
    assert.equal(own[0].id, 2);

    assert.equal(ok(await api("POST", "/indexes/products/count", {})).count, 3);
    assert.equal(
      ok(await api("POST", "/indexes/products/count", { filter: { price: { gt: 50 } } })).count,
      2,
    );
    const groups = ok(
      await api("POST", "/indexes/products/aggregate", { group_by: "color", sum: "price" }),
    );
    const red = groups.data.find((g: any) => g.group.color === "red");
    assert.deepEqual(red, { group: { color: "red" }, count: 1, sum: { price: 89 } });
  },
);

test("rows: get, update, delete, list and new fields", { skip }, async () => {
  const { api } = await started();
  ok(await api("POST", "/indexes/products/rows", PRODUCTS));
  const made = ok(
    await api("POST", "/indexes/products/rows", { text: "blue sock", price: 5, size: "m" }),
  );
  assert.equal(typeof made.ids[0], "string");
  const info = ok(await api("GET", "/indexes/products"));
  assert.ok(info.schema.attributes.some((a: any) => a.name === "size" && a.type === "text"));

  assert.equal(ok(await api("GET", "/indexes/products/rows/1")).price, 89);
  assert.equal(
    ok(await api("PATCH", "/indexes/products/rows", { id: 1, fields: { price: 79, stock: 3 } }))
      .count,
    1,
  );
  const row = ok(await api("GET", "/indexes/products/rows/1"));
  assert.deepEqual([row.price, row.stock], [79, 3]);
  const changed = ok(
    await api("PATCH", "/indexes/products/rows", {
      filter: { tags: { contains: "sale" } },
      fields: { promo: true },
    }),
  );
  assert.equal(changed.count, 2);
  assert.equal(ok(await api("GET", "/indexes/products/rows/3")).promo, true);

  assert.equal(ok(await api("POST", "/indexes/products/rows/delete", { id: 2 })).count, 1);
  const gone = await api("GET", "/indexes/products/rows/2");
  assert.equal(gone.status, 404);
  assert.equal(gone.body.error.code, "not_found");
  assert.equal(
    ok(await api("POST", "/indexes/products/rows/delete", { filter: { price: { lt: 10 } } })).count,
    1,
  );

  const first = ok(await api("GET", "/indexes/products/rows?limit=1"));
  assert.equal(first.data.length, 1);
  assert.ok(first.next);
  const rest = ok(
    await api("GET", `/indexes/products/rows?limit=10&cursor=${encodeURIComponent(first.next)}`),
  );
  assert.deepEqual([...first.data, ...rest.data].map((r: any) => r.id).sort(), [1, 3]);
  assert.equal(rest.next, null);

  const bad = await api("POST", "/indexes/products/rows", { id: 9, price: "cheap" });
  assert.equal(bad.status, 400);
  const vector = await api("POST", "/indexes/products/rows", {
    id: 9,
    text: "x",
    embedding: [1, 2],
  });
  assert.equal(vector.status, 400);
  assert.match(vector.body.error.hint, /new index/);
});

test(
  "rows: plain rows go straight to the engine, the rest through the checks",
  { skip },
  async () => {
    const { s, key, api } = await started(false);
    const schema = {
      vectors: [{ name: "v", dims: 2 }],
      attributes: [
        { name: "tag", type: "string" },
        { name: "n", type: "int" },
      ],
    };
    ok(await api("POST", "/indexes", { name: "plain", schema, embed: false }), 201);
    const rows = [
      { id: 1, v: [0.5, 1], tag: "a", n: 3 },
      { id: "two", v: [0, 1], tag: null },
    ];
    assert.deepEqual(ok(await api("POST", "/indexes/plain/rows", rows)), {
      ids: [1, "two"],
      count: 2,
    });
    const one = ok(await api("GET", "/indexes/plain/rows/1"));
    assert.deepEqual([one.tag, one.n], ["a", 3]);
    assert.equal(ok(await api("GET", "/indexes/plain/rows/two")).tag, undefined);

    ok(await api("POST", "/indexes/plain/rows", { id: 3, v: [1, 1], fresh: true }));
    assert.equal(ok(await api("GET", "/indexes/plain/rows/3")).fresh, true);
    const made = ok(await api("POST", "/indexes/plain/rows", { v: [1, 0] }));
    assert.equal(typeof made.ids[0], "string");
    assert.equal((await api("POST", "/indexes/plain/rows", { id: 4, v: [1, 2, 3] })).status, 400);
    assert.equal(
      (await api("POST", "/indexes/plain/rows", { id: 4, v: [1, 2], n: 1.5 })).status,
      400,
    );

    const inner = await s.app.request("/v1/indexes/plain/branches/main/rows", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(rows),
    });
    assert.equal(inner.status, 404);
  },
);

const base64 = (floats: number[]) =>
  Buffer.from(new Float32Array(floats).buffer).toString("base64");

test("rows: base64 vectors are exact on both paths and checked", { skip }, async () => {
  const { api } = await started(false);
  const encoded = "/indexes/vecs/rows?vector_encoding=base64";
  assert.equal((await api("POST", encoded, { id: 1, v: base64([1, 2]) })).status, 400);
  const schema = {
    vectors: [{ name: "v", dims: 2 }],
    attributes: [{ name: "tag", type: "string" }],
  };
  ok(await api("POST", "/indexes", { name: "vecs", schema, embed: false }), 201);

  const exact = [0.1, -3.4028234663852886e38];
  assert.deepEqual(ok(await api("POST", encoded, [{ id: 1, v: base64(exact), tag: "a" }])), {
    ids: [1],
    count: 1,
  });
  ok(await api("POST", encoded, { id: 2, v: base64([0.5, 0.25]), fresh: 7 }));
  assert.equal(ok(await api("GET", "/indexes/vecs/rows/2")).fresh, 7);
  ok(await api("POST", encoded, { id: 3, v: [3, 4] }));

  for (const v of [base64([1]), base64([1, NaN]), base64([1, Infinity]), "not base64!", "AAAA"]) {
    const bad = await api("POST", encoded, { id: 9, v });
    assert.equal(bad.status, 400, v);
  }
  assert.equal((await api("POST", "/indexes/vecs/rows", { id: 9, v: base64([1, 2]) })).status, 400);
});

test("rows: decoding base64 keeps every float32 bit", () => {
  const floats = Float32Array.from([0.1, -0, 1e-45, 3.4028234663852886e38, -1.5]);
  const text = Buffer.from(floats.buffer).toString("base64");
  const [row] = decodeVectors([{ id: 1, v: text }], { vectors: [{ name: "v", dims: 5 } as any] });
  assert.deepEqual(row!.v, Array.from(floats));
});

test("index settings: list, create, configure, copy and destroy", { skip }, async () => {
  const { s, key, api } = await started();
  ok(await api("POST", "/indexes/products/rows", PRODUCTS));
  const schema = { attributes: [{ name: "title", type: "text" }], vectors: [] };
  const made = ok(await api("POST", "/indexes", { name: "docs", schema }), 201);
  assert.equal(made.schema.vectors[0].name, "_meaning");
  const plain = ok(await api("POST", "/indexes", { name: "plain", schema, embed: false }), 201);
  assert.equal(plain.schema.vectors.length, 0);
  const empty = await api("POST", "/indexes", { name: "empty" });
  assert.equal(empty.status, 400);
  assert.match(empty.body.error.hint, /first upsert/);
  assert.equal((await api("POST", "/indexes", { name: "docs", schema })).status, 409);

  await client(s, key, "staging")("POST", "/indexes/elsewhere/rows", { id: 1, text: "x" });
  const listed = ok(await api("GET", "/indexes"));
  assert.deepEqual(
    listed.data.map((i: any) => i.name),
    ["docs", "plain", "products"],
  );
  const page = ok(await api("GET", "/indexes?limit=2"));
  assert.equal(page.next, "plain");

  const configured = ok(await api("PATCH", "/indexes/products", { retention_days: 7 }));
  assert.equal(configured.retention_days, 7);
  const copy = ok(await api("POST", "/indexes/products/copy", { name: "products-v2" }), 201);
  assert.equal(copy.name, "products-v2");
  assert.equal(ok(await api("POST", "/indexes/products-v2/count", {})).count, 3);
  ok(
    await api("POST", "/indexes/products/copy", { name: "products", environment: "staging" }),
    201,
  );
  assert.equal(ok(await client(s, key, "staging")("POST", "/indexes/products/count", {})).count, 3);

  ok(await api("DELETE", "/indexes/products-v2"), 204);
  assert.equal((await api("GET", "/indexes/products-v2")).status, 404);
});

test("index branches: fork, merge, versions and restore", { skip }, async () => {
  const { api } = await started();
  ok(await api("POST", "/indexes/products/rows", PRODUCTS));
  const fork = ok(await api("POST", "/indexes/products/branches", { name: "draft" }), 201);
  assert.deepEqual([fork.name, fork.from], ["draft", "main"]);
  ok(
    await api("POST", "/indexes/products/rows?branch=draft", {
      id: 4,
      text: "lime shoe",
      price: 50,
    }),
  );
  assert.equal(ok(await api("POST", "/indexes/products/count", { branch: "draft" })).count, 4);
  assert.equal(ok(await api("POST", "/indexes/products/count", {})).count, 3);
  const found = ok(
    await api("POST", "/indexes/products/query", {
      text: "lime",
      mode: "keywords",
      branch: "draft",
    }),
  );
  assert.deepEqual(
    found.data.map((h: any) => h.id),
    [4],
  );
  const branches = ok(await api("GET", "/indexes/products/branches"));
  assert.deepEqual(
    branches.data.map((b: any) => b.name),
    ["draft", "main"],
  );
  assert.ok(ok(await api("POST", "/indexes/products/merges", { from: "draft" })).rows >= 1);
  assert.equal(ok(await api("POST", "/indexes/products/count", {})).count, 4);
  ok(await api("DELETE", "/indexes/products/branches/draft"), 204);

  const versions = ok(await api("GET", "/indexes/products/versions"));
  assert.ok(versions.data.length >= 2);
  const before = versions.data[versions.data.length - 1];
  const restored = ok(await api("POST", "/indexes/products/restore", { to: before.id }));
  assert.equal(restored.rows, before.rows);
  assert.equal(ok(await api("POST", "/indexes/products/count", {})).count, before.rows);
  const later = ok(
    await api("POST", "/indexes/products/restore", { to: new Date().toISOString() }),
  );
  assert.equal(later.rows, before.rows);
  assert.equal(
    (await api("POST", "/indexes/products/restore", { to: "yesterday-ish" })).status,
    400,
  );
});

test("errors have one shape, a hint, and stay in their environment", { skip }, async () => {
  const { s, key, api } = await started();
  ok(await api("POST", "/indexes/products/rows", PRODUCTS));
  const typo = await api("GET", "/indexes/prodcts");
  assert.equal(typo.status, 404);
  assert.deepEqual(Object.keys(typo.body.error).sort(), ["code", "hint", "message", "request_id"]);
  assert.match(typo.body.error.hint, /did you mean `products`/);
  assert.ok(typo.body.error.request_id);

  const staging = ok(
    await api("POST", "/keys", { name: "s", role: "write", environment: "staging" }),
    201,
  );
  const there = client(s, staging.key);
  assert.equal((await there("GET", "/indexes/products")).status, 404);
  const crossed = await client(s, staging.key, "prod")("GET", "/indexes/products");
  assert.equal(crossed.status, 403);
  assert.equal(crossed.body.error.code, "forbidden");
  assert.match(crossed.body.error.hint, /whoami/);

  const reader = ok(
    await api("POST", "/keys", { name: "r", role: "read", environment: "prod" }),
    201,
  );
  const read = client(s, reader.key);
  assert.equal(ok(await read("POST", "/indexes/products/count", {})).count, 3);
  const denied = await read("POST", "/indexes/products/rows", { id: 9, text: "x" });
  assert.equal(denied.status, 403);

  const invalid = await api("POST", "/indexes/products/query", { limit: "ten" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.path, "limit");
  const anonymous = await s.app.request("/v2/whoami");
  assert.equal(anonymous.status, 401);
  assert.match((await anonymous.json()).error.hint, /skywake login/);
  const unscoped = client(s, key);
  assert.equal((await unscoped("GET", "/indexes/products")).status, 404);
});

test("unknown routes point at the API description", { skip }, async () => {
  const { s, api } = await started(false);
  const nowhere = await api("GET", "/nowhere");
  assert.equal(nowhere.status, 404);
  assert.match(nowhere.body.error.hint, /openapi/);
  const doc = await (await s.app.request("/v2/openapi.json")).json();
  assert.equal(doc.info.version, "2.0.0");
  assert.ok(doc.paths["/indexes/{index}/rows"].post);
});
