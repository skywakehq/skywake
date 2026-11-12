import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { retryingFetch, Skywake, SkywakeError } from "../dist/index.js";

type Handler = (request: IncomingMessage, response: ServerResponse, count: number) => void;

/** A fake API that answers with `handler`, and counts requests. */
async function fake(handler: Handler) {
  let count = 0;
  const server = createServer((request, response) => handler(request, response, ++count));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    count: () => count,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const json = (response: ServerResponse, status: number, body: unknown, headers = {}) => {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};

const failure = (code: string) => ({ error: "nope", code, request_id: "req-1" });

test("idempotent requests are retried after a 5xx", async (t) => {
  const api = await fake((_, response, count) =>
    count < 3 ? json(response, 503, failure("unavailable")) : json(response, 200, []),
  );
  t.after(api.close);
  const sky = new Skywake({ url: api.url, key: "k", backoffMs: 1 });
  assert.deepEqual(await sky.namespaces(), []);
  assert.equal(api.count(), 3);
});

test("a POST is not retried after a 5xx, since it may have landed", async (t) => {
  const api = await fake((_, response) => json(response, 503, failure("unavailable")));
  t.after(api.close);
  const sky = new Skywake({ url: api.url, key: "k", backoffMs: 1 });
  await assert.rejects(sky.createEnvironment("prod"), SkywakeError);
  assert.equal(api.count(), 1);
});

test("any request is retried after a 429, waiting as the server asks", async (t) => {
  const api = await fake((request, response, count) => {
    if (count === 1) return json(response, 429, failure("rate_limited"), { "retry-after": "1" });
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () =>
      json(response, 201, { ...JSON.parse(body), created: "" }),
    );
  });
  t.after(api.close);
  const sky = new Skywake({ url: api.url, key: "k" });
  const started = Date.now();
  const made = await sky.createEnvironment("prod");
  assert.equal(made.name, "prod", "the body is sent again");
  assert.ok(Date.now() - started >= 900);
  assert.equal(api.count(), 2);
});

test("retries stop after the last one, and the error says what and which request", async (t) => {
  const api = await fake((_, response) => json(response, 500, failure("internal")));
  t.after(api.close);
  const sky = new Skywake({ url: api.url, key: "k", retries: 2, backoffMs: 1 });
  const error = await sky.namespaces().catch((caught) => caught);
  assert.ok(error instanceof SkywakeError);
  assert.equal(error.status, 500);
  assert.equal(error.code, "internal");
  assert.equal(error.requestId, "req-1");
  assert.equal(error.message, "nope");
  assert.equal(api.count(), 3);
});

test("a request that takes too long is cut off and retried", async (t) => {
  const api = await fake((_, response, count) => {
    if (count === 1) return; // never answers
    json(response, 200, []);
  });
  t.after(api.close);
  const sky = new Skywake({ url: api.url, key: "k", timeoutMs: 100, backoffMs: 1 });
  assert.deepEqual(await sky.namespaces(), []);
  assert.equal(api.count(), 2);

  const hung = await fake(() => {});
  t.after(hung.close);
  const cut = new Skywake({ url: hung.url, key: "k", timeoutMs: 100, retries: 0 });
  await assert.rejects(cut.namespaces(), (error: Error) => error.name === "TimeoutError");
});

test("the timeout covers the wait for an answer, not reading a large one", async (t) => {
  const chunks = ["a", "b", "c", "d"];
  const api = await fake((_, response) => {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    // Each part comes after a pause, so the whole body takes longer than the timeout.
    const next = () => {
      const chunk = chunks.shift();
      if (chunk === undefined) return response.end();
      response.write(chunk);
      setTimeout(next, 60);
    };
    next();
  });
  t.after(api.close);
  const sky = new Skywake({ url: api.url, key: "k", timeoutMs: 100, retries: 0 });
  assert.equal(await sky.namespace("x").branch("main").readText("big"), "abcd");
});

test("a file can be read as a stream", async (t) => {
  const api = await fake((request, response) => {
    assert.match(request.url!, /files\/content\?path=a.txt/);
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write("hello ");
    response.end("world");
  });
  t.after(api.close);
  const branch = new Skywake({ url: api.url, key: "k" }).namespace("x").branch("main");
  const parts: string[] = [];
  for await (const part of (await branch.readStream("a.txt")).pipeThrough(new TextDecoderStream()))
    parts.push(part);
  assert.equal(parts.join(""), "hello world");

  const missing = await fake((_, response) => json(response, 404, failure("not_found")));
  t.after(missing.close);
  const gone = new Skywake({ url: missing.url, key: "k" }).namespace("x").branch("main");
  await assert.rejects(gone.readStream("a.txt"), { code: "not_found", status: 404 });
});

test("a 4xx is not retried", async (t) => {
  const api = await fake((_, response) => json(response, 404, failure("not_found")));
  t.after(api.close);
  const sky = new Skywake({ url: api.url, key: "k", backoffMs: 1 });
  await assert.rejects(sky.namespace("x").branches(), { code: "not_found", status: 404 });
  assert.equal(api.count(), 1);
});

test("a wait the server asks for is kept, up to its longest", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const send = async () =>
    ++calls === 1
      ? new Response(null, { status: 429, headers: { "retry-after": "60" } })
      : new Response("[]");
  const fetching = retryingFetch({}, send as typeof fetch)(new Request("http://api/v1/x"));
  const advance = async (ms: number) => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    t.mock.timers.tick(ms);
  };
  await advance(59_000);
  assert.equal(calls, 1, "it retried before the server's wait was over");
  await advance(1_000);
  assert.equal((await fetching).status, 200);
  assert.equal(calls, 2);
});

test("a DELETE retried after a failure that may have landed takes 404 as done", async (t) => {
  const api = await fake((_, response, count) =>
    count === 1
      ? json(response, 503, failure("unavailable"))
      : json(response, 404, failure("not_found")),
  );
  t.after(api.close);
  const sky = new Skywake({ url: api.url, key: "k", backoffMs: 1 });
  await sky.namespace("x").branch("gone").delete();
  assert.equal(api.count(), 2);

  // A 404 on the first try is still an error.
  const missing = await fake((_, response) => json(response, 404, failure("not_found")));
  t.after(missing.close);
  const other = new Skywake({ url: missing.url, key: "k", backoffMs: 1 });
  await assert.rejects(other.namespace("x").branch("gone").delete(), { status: 404 });
});

test("a list takes a page, and `all` follows `after` until a short page", async (t) => {
  const asked: URLSearchParams[] = [];
  const names = Array.from({ length: 1001 }, (_, i) => `b${String(i).padStart(4, "0")}`);
  const api = await fake((request, response) => {
    const query = new URL(request.url!, "http://x").searchParams;
    asked.push(query);
    const after = query.get("after");
    const start = after ? names.indexOf(after) + 1 : 0;
    const page = names.slice(start, start + Number(query.get("limit") ?? 1000));
    json(
      response,
      200,
      page.map((name) => ({ name, forked_from: null, protected: false, created: "" })),
    );
  });
  t.after(api.close);
  const ns = new Skywake({ url: api.url, key: "k" }).namespace("prod/app");

  const page = await ns.branches({ limit: 2, after: "b0005" });
  assert.deepEqual(
    page.map((branch) => branch.name),
    ["b0006", "b0007"],
  );
  assert.equal(asked[0]!.toString(), "limit=2&after=b0005");

  const all = [];
  for await (const branch of ns.allBranches()) all.push(branch.name);
  assert.deepEqual(all, names);
  assert.deepEqual(
    asked.slice(1).map((query) => query.toString()),
    ["limit=1000", "limit=1000&after=b0999"],
  );
});

test("folder entries are paged by name", async (t) => {
  const asked: string[] = [];
  const api = await fake((request, response) => {
    asked.push(new URL(request.url!, "http://x").search);
    const entries = Array.from({ length: asked.length === 1 ? 1000 : 3 }, (_, i) => ({
      name: `${asked.length}-${i}`,
      kind: "file",
      size: 0,
      executable: false,
      modified: 0,
    }));
    json(response, 200, {
      name: "",
      kind: "folder",
      size: 0,
      executable: false,
      modified: 0,
      entries,
    });
  });
  t.after(api.close);
  const main = new Skywake({ url: api.url, key: "k" }).namespace("app").branch("main");
  let count = 0;
  for await (const _ of main.allEntries("src")) count++;
  assert.equal(count, 1003);
  assert.deepEqual(asked, ["?path=src&limit=1000", "?path=src&limit=1000&after=1-999"]);
});

/** A fake API that records each request and its JSON body, and answers with `answer`. */
async function recording(answer: (method: string, url: string, body: any) => [number, unknown]) {
  const seen: { method: string; url: string; body: any }[] = [];
  const api = await fake((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      const body = text ? JSON.parse(text) : null;
      seen.push({ method: request.method!, url: request.url!, body });
      const [status, reply] = answer(request.method!, request.url!, body);
      if (status === 204) response.writeHead(204).end();
      else json(response, status, reply);
    });
  });
  return { ...api, seen, sky: new Skywake({ url: api.url, key: "k", backoffMs: 1 }) };
}

test("an organization and its keys are made, listed and revoked", async (t) => {
  const api = await recording((method, url) => {
    if (url === "/v1/orgs") return [201, { id: "org_1", key: "sw_first" }];
    if (method === "DELETE") return [204, null];
    if (method === "GET") return [200, [{ id: "key_1", name: "ci", role: "write" }]];
    return [201, { id: "key_1", key: "sw_new" }];
  });
  t.after(api.close);
  assert.deepEqual(await api.sky.createOrg("acme"), { id: "org_1", key: "sw_first" });
  const made = await api.sky.keys.create("ci", "write", {
    namespaces: "prod/*",
    expiresInDays: 30,
  });
  assert.deepEqual(made, { id: "key_1", key: "sw_new" });
  await api.sky.keys.create("all", "read");
  assert.equal((await api.sky.keys.list())[0]!.name, "ci");
  await api.sky.keys.revoke("key_1");
  assert.deepEqual(
    api.seen.map(({ method, url, body }) => [method, url, body]),
    [
      ["POST", "/v1/orgs", { name: "acme" }],
      [
        "POST",
        "/v1/keys",
        { name: "ci", role: "write", namespaces: "prod/*", expires_in_days: 30 },
      ],
      ["POST", "/v1/keys", { name: "all", role: "read" }],
      ["GET", "/v1/keys", null],
      ["DELETE", "/v1/keys/key_1", null],
    ],
  );
});

test("a merge can be a dry run, and a fork can start at an older commit", async (t) => {
  const api = await recording((_, url, body) =>
    url.endsWith("/merges") ? [200, { head: null, conflicts: ["a.txt"] }] : [201, body],
  );
  t.after(api.close);
  const ns = api.sky.namespace("app");
  const merged = await ns.branch("try").mergeInto("main", { dryRun: true });
  assert.deepEqual(merged, { head: null, conflicts: ["a.txt"] });
  await ns.merge("try", "main", { message: "m" });
  const forked = await ns.branch("main").fork("old", "c0ffee");
  assert.equal(forked.name, "old");
  assert.deepEqual(
    api.seen.map(({ url, body }) => [url, body]),
    [
      ["/v1/namespaces/app/merges", { from: "try", into: "main", dry_run: true }],
      ["/v1/namespaces/app/merges", { from: "try", into: "main", message: "m" }],
      ["/v1/namespaces/app/branches", { name: "old", from: "main", at: "c0ffee" }],
    ],
  );
});

test("a revert, a reset, a resolved merge and a diff against the base", async (t) => {
  const conflict = { conflicts: ["a.txt"], error: "nope", code: "conflict", request_id: "r" };
  const api = await recording((_, url, body) => {
    if (url.endsWith("/revert"))
      return body.commit === "bad" ? [409, conflict] : [201, { head: "h1", changed: true }];
    if (url.endsWith("/reset")) return [200, { head: "h0", changed: false }];
    if (url.endsWith("/merges")) return [409, { head: null, ...conflict, conflicts: ["b.txt"] }];
    return [200, []];
  });
  t.after(api.close);
  const ns = api.sky.namespace("app");
  const main = ns.branch("main");

  assert.deepEqual(await main.revert("c1", { message: "undo" }), { head: "h1", changed: true });
  const error = await main.revert("bad").catch((caught) => caught);
  assert.ok(error instanceof SkywakeError);
  assert.equal(error.status, 409);
  assert.deepEqual(error.conflicts, ["a.txt"]);
  assert.deepEqual(await main.reset("c0", { session: "s" }), { head: "h0", changed: false });

  const resolve = [{ path: "a.txt", take: "ours" as const }];
  const merged = await ns.branch("try").mergeInto("main", { resolve });
  assert.deepEqual(merged.conflicts, ["b.txt"], "the paths still open");

  await main.diff("dev", { against: "base" });
  assert.deepEqual(
    api.seen.map(({ url, body }) => [url, body]),
    [
      ["/v1/namespaces/app/branches/main/revert", { commit: "c1", message: "undo" }],
      ["/v1/namespaces/app/branches/main/revert", { commit: "bad" }],
      ["/v1/namespaces/app/branches/main/reset", { to: "c0", session: "s" }],
      ["/v1/namespaces/app/merges", { from: "try", into: "main", resolve }],
      ["/v1/namespaces/app/branches/main/diff?from=dev&against=base", null],
    ],
  );
});

test("a branch can be protected and unprotected", async (t) => {
  const api = await recording(() => [200, { name: "main", protected: true }]);
  t.after(api.close);
  const main = api.sky.namespace("app").branch("main");
  await main.protect();
  await main.protect(false);
  assert.deepEqual(
    api.seen.map(({ method, url, body }) => [method, url, body]),
    [
      ["PATCH", "/v1/namespaces/app/branches/main", { protected: true }],
      ["PATCH", "/v1/namespaces/app/branches/main", { protected: false }],
    ],
  );
});
