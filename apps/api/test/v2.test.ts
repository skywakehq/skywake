import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

import { server, skip, type Server } from "./helpers.ts";

const TOPICS = ["shoe", "coffee", "invoice", "giraffe"];

function vectorOf(text: string) {
  const lower = text.toLowerCase();
  return [...TOPICS.map((word) => lower.split(word).length - 1), 0.05];
}

const provider = createServer((request, response) => {
  let raw = "";
  request.on("data", (part) => (raw += part));
  request.on("end", () => {
    const inputs: string[] = JSON.parse(raw).input;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ data: inputs.map((text, index) => ({ index, embedding: vectorOf(text) })) }),
    );
  });
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
after(() => provider.close());
const embed = { url: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1` };

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

  ok(await api("POST", "/disks", { name: "shared" }), 201);
  const taken = await api("POST", "/indexes/shared/rows", { id: 1, text: "x" });
  assert.equal(taken.status, 409);
  assert.match(taken.body.error.hint, /can't share a name/);
});

test("disk files: write, read, list, commit, log, delete", { skip }, async () => {
  const { api } = await started(false);
  const wrote = ok(await api("PUT", "/disks/app/files/notes.md", undefined, "hello"));
  assert.equal(wrote.changed, true);
  const read = await api("GET", "/disks/app/files/notes.md");
  assert.equal(read.body, "hello");
  const again = ok(await api("PUT", "/disks/app/files/notes.md", undefined, "hello"));
  assert.equal(again.changed, false);

  const many = ok(
    await api("POST", "/disks/app/commits", {
      message: "add source",
      changes: [
        { path: "src/main.ts", text: "export const x = 1; // TODO" },
        { path: "src/lib/util.ts", text: "export const y = 2;" },
      ],
    }),
  );
  assert.equal(many.changed, true);
  const log = ok(await api("GET", "/disks/app/commits"));
  assert.deepEqual(log.data.map((c: any) => c.message).slice(0, 2), [
    "add source",
    "Change notes.md",
  ]);
  assert.equal(log.data[0].id, many.commit);
  const history = ok(await api("GET", "/disks/app/commits?path=notes.md"));
  assert.equal(history.data.length, 1);

  const root = ok(await api("GET", "/disks/app/files"));
  assert.deepEqual(
    root.data.map((e: any) => [e.path, e.kind]),
    [
      ["notes.md", "file"],
      ["src", "folder"],
    ],
  );
  assert.ok(root.data[0].modified);
  const src = ok(await api("GET", "/disks/app/files?path=src"));
  assert.deepEqual(
    src.data.map((e: any) => e.path),
    ["src/lib", "src/main.ts"],
  );
  const all = ok(await api("GET", "/disks/app/files?recursive=true"));
  assert.ok(all.data.some((e: any) => e.path === "src/lib/util.ts"));
  const old = await api("GET", `/disks/app/files/notes.md?at=${log.data[1].id}`);
  assert.equal(old.body, "hello");

  ok(await api("DELETE", "/disks/app/files/notes.md"));
  assert.equal((await api("GET", "/disks/app/files/notes.md")).status, 404);
  const missing = await api("GET", "/disks/ap/files/notes.md");
  assert.match(missing.body.error.hint, /did you mean `app`/);
});

test("disk search: grep, find and query by meaning", { skip }, async () => {
  const { s, api } = await started();
  const made = ok(await api("POST", "/disks", { name: "app" }), 201);
  assert.equal(made.search, true);
  ok(
    await api("POST", "/disks/app/commits", {
      changes: [
        { path: "docs/coffee.md", text: "How we brew coffee every morning." },
        { path: "docs/billing.md", text: "Every invoice is sent on the first." },
        { path: "src/app.ts", text: "// TODO handle invoice retries" },
      ],
    }),
  );
  const grep = ok(await api("POST", "/disks/app/grep", { pattern: "TODO" }));
  assert.deepEqual(grep.data, [
    { path: "src/app.ts", line: 1, text: "// TODO handle invoice retries" },
  ]);
  const found = ok(await api("POST", "/disks/app/find", { glob: "*.md" }));
  assert.deepEqual(
    found.data.map((f: any) => f.path),
    ["docs/billing.md", "docs/coffee.md"],
  );

  await s.services.syncer.drain();
  const hits = ok(await api("POST", "/disks/app/query", { text: "coffee", limit: 1 }));
  assert.equal(hits.data[0].path, "docs/coffee.md");
  assert.match(hits.data[0].snippet, /coffee/);
  const scoped = ok(await api("POST", "/disks/app/query", { text: "invoice", path: "docs" }));
  assert.equal(scoped.data[0].path, "docs/billing.md");
  assert.ok(scoped.data.every((h: any) => h.path.startsWith("docs/")));

  const listed = ok(await api("GET", "/indexes"));
  assert.deepEqual(listed.data, []);
  const off = ok(await api("PATCH", "/disks/app", { search: false }));
  assert.equal(off.search, false);
  const refused = await api("POST", "/disks/app/query", { text: "coffee" });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error.hint, /"search": true/);
});

test("disk branches: fork, diff, merge, conflicts, revert and restore", { skip }, async () => {
  const { api } = await started(false);
  const first = ok(await api("PUT", "/disks/app/files/a.txt", undefined, "one"));
  const fork = ok(await api("POST", "/disks/app/branches", { name: "agent-1" }), 201);
  assert.deepEqual([fork.name, fork.from], ["agent-1", "main"]);
  ok(await api("PUT", "/disks/app/files/b.txt?branch=agent-1", undefined, "new"));
  const diff = ok(await api("GET", "/disks/app/diff?branch=agent-1&against=main"));
  assert.deepEqual(diff.data, [{ path: "b.txt", change: "added" }]);
  const merged = ok(await api("POST", "/disks/app/merges", { from: "agent-1" }));
  assert.ok(merged.commit);
  assert.equal((await api("GET", "/disks/app/files/b.txt")).body, "new");

  ok(await api("PUT", "/disks/app/files/a.txt?branch=agent-1", undefined, "theirs"));
  ok(await api("PUT", "/disks/app/files/a.txt", undefined, "ours"));
  const conflict = await api("POST", "/disks/app/merges", { from: "agent-1" });
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body.error.conflicts, ["a.txt"]);
  const settled = ok(await api("POST", "/disks/app/merges", { from: "agent-1", prefer: "theirs" }));
  assert.deepEqual(settled.conflicts, []);
  assert.equal((await api("GET", "/disks/app/files/a.txt")).body, "theirs");

  const branches = ok(await api("GET", "/disks/app/branches"));
  assert.deepEqual(
    branches.data.map((b: any) => b.name),
    ["agent-1", "main"],
  );
  ok(await api("DELETE", "/disks/app/branches/agent-1"), 204);

  const change = ok(await api("PUT", "/disks/app/files/c.txt", undefined, "c"));
  ok(await api("POST", "/disks/app/revert", { commit: change.commit }));
  assert.equal((await api("GET", "/disks/app/files/c.txt")).status, 404);
  ok(await api("POST", "/disks/app/restore", { to: first.commit }));
  assert.equal((await api("GET", "/disks/app/files/a.txt")).body, "one");
  assert.equal((await api("GET", "/disks/app/files/b.txt")).status, 404);
});

test("disks: create, list, configure, uploads and destroy", { skip }, async () => {
  const { s, key, api } = await started(false);
  const made = ok(await api("POST", "/disks", { name: "app", visibility: "private" }), 201);
  assert.deepEqual([made.name, made.search, made.branches], ["app", false, ["main"]]);
  assert.equal((await api("POST", "/disks", { name: "app" })).status, 409);
  await client(s, key, "staging")("PUT", "/disks/other/files/x", undefined, "x");
  assert.deepEqual(
    ok(await api("GET", "/disks")).data.map((d: any) => d.name),
    ["app"],
  );
  assert.equal(ok(await api("PATCH", "/disks/app", { visibility: "public" })).visibility, "public");
  assert.equal(ok(await api("GET", "/disks/app")).visibility, "public");

  const part = ok(await api("POST", "/disks/big/uploads", undefined, "x".repeat(1000)), 201);
  assert.equal(part.size, 1000);
  ok(
    await api("POST", "/disks/big/commits", { changes: [{ path: "big.bin", parts: [part.part] }] }),
  );
  assert.equal((await api("GET", "/disks/big/files/big.bin")).body.length, 1000);
  const range = await api("GET", "/disks/big/files/big.bin?offset=10&length=5");
  assert.equal(range.body, "xxxxx");

  ok(await api("DELETE", "/disks/app"), 204);
  assert.equal((await api("GET", "/disks/app")).status, 404);
  const nowhere = await api("GET", "/nowhere");
  assert.equal(nowhere.status, 404);
  assert.match(nowhere.body.error.hint, /openapi/);
  const doc = await (await s.app.request("/v2/openapi.json")).json();
  assert.equal(doc.info.version, "2.0.0");
  assert.ok(doc.paths["/disks/{disk}/files/{path}"].put);
  assert.ok(doc.paths["/indexes/{index}/rows"].post);
});
