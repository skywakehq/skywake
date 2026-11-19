import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import {
  AuthError,
  MergeConflict,
  NotFound,
  PermissionError,
  RateLimited,
  ServerError,
  Skywake,
} from "../dist/index.js";

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Handler = (seen: Seen, count: number) => Reply;

async function fake(handler: Handler) {
  const seen: Seen[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://x");
      const one = {
        method: request.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
        headers: request.headers,
        body: Buffer.concat(chunks),
      };
      seen.push(one);
      const reply = handler(one, seen.length);
      const status = reply.status ?? 200;
      response.writeHead(status, { "content-type": "application/json", ...reply.headers });
      response.end(reply.body === undefined ? "" : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    sky: (options = {}) =>
      new Skywake({ url: `http://127.0.0.1:${port}`, key: "k", backoffMs: 1, ...options }),
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const failure = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  status,
  body: { error: { code, message: "nope", hint: null, request_id: "req-1", ...extra } },
});

const json = (seen: Seen) => JSON.parse(seen.body.toString("utf8"));

test("requests go to /v2 with the key and the environment", async (t) => {
  const api = await fake(() => ({ body: { organization: "acme", environment: "prod" } }));
  t.after(api.close);
  const me = await api.sky({ environment: "prod" }).whoami();
  assert.equal(me.environment, "prod");
  assert.equal(api.seen[0]!.path, "/v2/whoami");
  assert.equal(api.seen[0]!.headers.authorization, "Bearer k");
  assert.equal(api.seen[0]!.headers["skywake-environment"], "prod");
});

test("each status becomes its own error, with the hint in the message", async (t) => {
  const replies = [
    failure(401, "unauthorized"),
    failure(403, "forbidden"),
    failure(404, "not_found", { hint: "did you mean `products`?" }),
    failure(500, "internal"),
  ];
  const api = await fake((_, count) => replies[Math.min(count, 4) - 1]!);
  t.after(api.close);
  const sky = api.sky({ retries: 0 });
  await assert.rejects(sky.whoami(), AuthError);
  await assert.rejects(sky.whoami(), PermissionError);
  await assert.rejects(sky.index("prodcts").info(), (error: NotFound) => {
    assert.ok(error instanceof NotFound);
    assert.equal(error.hint, "did you mean `products`?");
    assert.match(error.message, /did you mean `products`\?/);
    assert.equal(error.requestId, "req-1");
    return true;
  });
  await assert.rejects(sky.whoami(), ServerError);
});

test("a 429 is retried as the server asks, then reported with retryAfter", async (t) => {
  const limited = { ...failure(429, "rate_limited"), headers: { "retry-after": "1" } };
  const api = await fake(() => limited);
  t.after(api.close);
  await assert.rejects(api.sky({ retries: 1 }).whoami(), (error: RateLimited) => {
    assert.ok(error instanceof RateLimited);
    assert.equal(error.retryAfter, 1);
    return true;
  });
  assert.equal(api.seen.length, 2);
});

test("a merge that can't finish is a MergeConflict listing what conflicts", async (t) => {
  const api = await fake(() => failure(409, "conflict", { conflicts: ["mug"] }));
  t.after(api.close);
  const work = api.sky().index("products", { branch: "agent-1" });
  await assert.rejects(work.mergeInto(), (error: MergeConflict) => {
    assert.ok(error instanceof MergeConflict);
    assert.deepEqual(error.conflicts, ["mug"]);
    return true;
  });
  assert.deepEqual(json(api.seen[0]!), { from: "agent-1", into: "main" });
});

test("lists follow next until the last page", async (t) => {
  const api = await fake((seen) =>
    seen.query.get("cursor") === "b"
      ? { body: { data: [{ name: "c" }], next: null } }
      : { body: { data: [{ name: "a" }, { name: "b" }], next: "b" } },
  );
  t.after(api.close);
  const names = [];
  for await (const index of api.sky().listIndexes()) names.push(index.name);
  assert.deepEqual(names, ["a", "b", "c"]);
});

test("upsert takes any number of rows and sends them in batches", async (t) => {
  const api = await fake((seen) => {
    const rows = json(seen) as { id: number }[];
    return { body: { ids: rows.map((row) => row.id), count: rows.length } };
  });
  t.after(api.close);
  const rows = Array.from({ length: 25_000 }, (_, id) => ({ id, text: `row ${id}` }));
  const done = await api.sky().index("products").upsert(rows);
  assert.equal(done.count, 25_000);
  assert.equal(done.ids.length, 25_000);
  assert.deepEqual(
    api.seen.map((seen) => (json(seen) as unknown[]).length),
    [10_000, 10_000, 5_000],
  );
  assert.equal(api.seen[0]!.query.get("branch"), "main");
});

test("update and delete take an id, ids, or a filter", async (t) => {
  const api = await fake(() => ({ body: { count: 1 } }));
  t.after(api.close);
  const products = api.sky().index("products");
  await products.update(7, { stock: 3 });
  await products.update({ tag: { eq: "sale" } }, { stock: 0 });
  await products.delete([1, 2]);
  await products.delete({ filter: { stock: { eq: 0 } } });
  assert.deepEqual(
    api.seen.map((seen) => [seen.method, seen.path, json(seen)]),
    [
      ["PATCH", "/v2/indexes/products/rows", { id: 7, fields: { stock: 3 } }],
      [
        "PATCH",
        "/v2/indexes/products/rows",
        { filter: { tag: { eq: "sale" } }, fields: { stock: 0 } },
      ],
      ["POST", "/v2/indexes/products/rows/delete", { ids: [1, 2] }],
      ["POST", "/v2/indexes/products/rows/delete", { filter: { stock: { eq: 0 } } }],
    ],
  );
});

test("get gives null for a missing row but throws for a missing index", async (t) => {
  const api = await fake((seen) =>
    seen.path.includes("/rows/")
      ? failure(404, "not_found", { path: "id" })
      : failure(404, "not_found", { hint: "did you mean `products`?" }),
  );
  t.after(api.close);
  const sky = api.sky();
  assert.equal(await sky.index("products").get("a b"), null);
  assert.equal(api.seen[0]!.path, "/v2/indexes/products/rows/a%20b");
  await assert.rejects(sky.index("prodcts").info(), NotFound);
});

test("query takes text first, and options on their own", async (t) => {
  const api = await fake(() => ({
    body: { data: [{ id: 1, score: 0.9, title: "mug" }], next: null },
  }));
  t.after(api.close);
  const products = api.sky().index("products", { branch: "draft" });
  const [hit] = await products.query("coffee", { limit: 3, mode: "keywords" });
  assert.equal(hit!.title, "mug");
  await products.query({ filter: { price: { lt: 10 } }, sort: { price: "asc" } });
  assert.deepEqual(json(api.seen[0]!), {
    text: "coffee",
    limit: 3,
    mode: "keywords",
    branch: "draft",
  });
  assert.deepEqual(json(api.seen[1]!), {
    filter: { price: { lt: 10 } },
    sort: { price: "asc" },
    branch: "draft",
  });
});

test("a fork is a handle on the new branch, and destroy removes just the branch", async (t) => {
  const api = await fake((seen) =>
    seen.method === "DELETE" ? { status: 204 } : { status: 201, body: { name: "agent-1" } },
  );
  t.after(api.close);
  const work = await api.sky().index("products").fork("agent-1", { at: "v3" });
  assert.equal(work.branch, "agent-1");
  await work.destroy();
  assert.deepEqual(json(api.seen[0]!), { name: "agent-1", from: "main", at: "v3" });
  assert.deepEqual(
    [api.seen[1]!.method, api.seen[1]!.path],
    ["DELETE", "/v2/indexes/products/branches/agent-1"],
  );
});

test("restore to a time sends it as an instant", async (t) => {
  const api = await fake(() => ({ body: { id: "v2", created: "2026-01-02T00:00:00Z" } }));
  t.after(api.close);
  await api.sky().index("products").restore(new Date("2026-01-02T12:00:00Z"));
  assert.deepEqual(json(api.seen[0]!), { to: "2026-01-02T12:00:00.000Z", branch: "main" });
});
