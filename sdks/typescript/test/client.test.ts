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

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; raw?: Buffer };
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
      if (reply.raw) {
        response.writeHead(status, { "content-type": "application/octet-stream" });
        return response.end(reply.raw);
      }
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

test("a path can't climb out of its disk with `.` or `..`", async (t) => {
  const api = await fake(() => ({ raw: Buffer.from("hi") }));
  t.after(api.close);
  const app = api.sky().disk("app");
  await assert.rejects(app.read("../../../keys"), TypeError);
  await assert.rejects(app.read("docs/./a.md"), TypeError);
  await assert.rejects(api.sky().disk("..").read("a.md"), TypeError);
  assert.equal(await app.read("docs/..a.md"), "hi");
  assert.equal(api.seen.length, 1);
  assert.equal(api.seen[0]!.path, "/v2/disks/app/files/docs/..a.md");
});

test("each status becomes its own error, with the hint in the message", async (t) => {
  const replies = [
    failure(401, "unauthorized"),
    failure(403, "forbidden"),
    failure(404, "not_found", { hint: "did you mean `app`?" }),
    failure(500, "internal"),
  ];
  const api = await fake((_, count) => replies[Math.min(count, 4) - 1]!);
  t.after(api.close);
  const sky = api.sky({ retries: 0 });
  await assert.rejects(sky.whoami(), AuthError);
  await assert.rejects(sky.whoami(), PermissionError);
  await assert.rejects(sky.disk("ap").info(), (error: NotFound) => {
    assert.ok(error instanceof NotFound);
    assert.equal(error.hint, "did you mean `app`?");
    assert.match(error.message, /did you mean `app`\?/);
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
  const api = await fake(() => failure(409, "conflict", { conflicts: ["README.md"] }));
  t.after(api.close);
  const work = api.sky().disk("app", { branch: "agent-1" });
  await assert.rejects(work.mergeInto(), (error: MergeConflict) => {
    assert.ok(error instanceof MergeConflict);
    assert.deepEqual(error.conflicts, ["README.md"]);
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
  for await (const disk of api.sky().listDisks()) names.push(disk.name);
  assert.deepEqual(names, ["a", "b", "c"]);
});

test("files are read and written by path, each part of it encoded", async (t) => {
  const api = await fake((seen) =>
    seen.method === "GET"
      ? { raw: Buffer.from("hello") }
      : { body: { commit: "c1", changed: true } },
  );
  t.after(api.close);
  const app = api.sky().disk("app");
  assert.equal(await app.read("/docs/a b.md", { at: "c0" }), "hello");
  assert.deepEqual(await app.read("x", { as: "bytes" }), new Uint8Array(Buffer.from("hello")));
  await app.write({ "a.md": "one", "b.bin": new Uint8Array([0xff, 0x00]) }, { message: "two" });
  assert.equal(api.seen[0]!.path, "/v2/disks/app/files/docs/a%20b.md");
  assert.equal(api.seen[0]!.query.get("at"), "c0");
  assert.deepEqual(json(api.seen[2]!), {
    message: "two",
    branch: "main",
    changes: [
      { path: "a.md", text: "one" },
      { path: "b.bin", base64: "/wA=" },
    ],
  });
});

test("a large file goes up in parts before its commit", async (t) => {
  const api = await fake((seen) =>
    seen.path.endsWith("/uploads")
      ? { status: 201, body: { part: `p${seen.body.length}`, size: seen.body.length } }
      : { body: { commit: "c1", changed: true } },
  );
  t.after(api.close);
  const big = new Uint8Array(20 * 1024 * 1024);
  await api.sky().disk("app").write("big.bin", big);
  const parts = api.seen.filter((seen) => seen.path.endsWith("/uploads"));
  assert.deepEqual(
    parts.map((seen) => seen.body.length),
    [16 * 1024 * 1024, 4 * 1024 * 1024],
  );
  const commit = json(api.seen.at(-1)!);
  assert.deepEqual(commit.changes, [
    { path: "big.bin", parts: [`p${16 * 1024 * 1024}`, `p${4 * 1024 * 1024}`] },
  ]);
});

test("a fork is a handle on the new branch, and destroy removes just the branch", async (t) => {
  const api = await fake((seen) =>
    seen.method === "DELETE" ? { status: 204 } : { status: 201, body: { name: "agent-1" } },
  );
  t.after(api.close);
  const work = await api.sky().disk("app").fork("agent-1", { at: "c3" });
  assert.equal(work.branch, "agent-1");
  await work.destroy();
  assert.deepEqual(json(api.seen[0]!), { name: "agent-1", from: "main", at: "c3" });
  assert.deepEqual(
    [api.seen[1]!.method, api.seen[1]!.path],
    ["DELETE", "/v2/disks/app/branches/agent-1"],
  );
});

test("restore to a time picks the newest commit at or before it", async (t) => {
  const api = await fake((seen) =>
    seen.method === "GET"
      ? {
          body: {
            data: [
              { id: "c3", message: "", created: "2026-01-03T00:00:00Z", merged: null },
              { id: "c2", message: "", created: "2026-01-02T00:00:00Z", merged: null },
            ],
            next: null,
          },
        }
      : { body: { commit: "c4", changed: true } },
  );
  t.after(api.close);
  await api.sky().disk("app").restore(new Date("2026-01-02T12:00:00Z"));
  assert.deepEqual(json(api.seen[1]!), { to: "c2", branch: "main" });
});
