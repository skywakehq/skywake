import assert from "node:assert/strict";
import { after, test } from "node:test";

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

test("errors have one shape, a hint, and stay in their environment", { skip }, async () => {
  const { s, key, api } = await started(false);
  ok(await api("PUT", "/disks/app/files/notes.md", undefined, "hello"));
  const typo = await api("GET", "/disks/ap");
  assert.equal(typo.status, 404);
  assert.deepEqual(Object.keys(typo.body.error).sort(), ["code", "hint", "message", "request_id"]);
  assert.match(typo.body.error.hint, /did you mean `app`/);
  assert.ok(typo.body.error.request_id);

  const staging = ok(
    await api("POST", "/keys", { name: "s", role: "write", environment: "staging" }),
    201,
  );
  const there = client(s, staging.key);
  assert.equal((await there("GET", "/disks/app")).status, 404);
  const crossed = await client(s, staging.key, "prod")("GET", "/disks/app");
  assert.equal(crossed.status, 403);
  assert.equal(crossed.body.error.code, "forbidden");
  assert.match(crossed.body.error.hint, /whoami/);

  const reader = ok(
    await api("POST", "/keys", { name: "r", role: "read", environment: "prod" }),
    201,
  );
  const read = client(s, reader.key);
  assert.equal((await read("GET", "/disks/app/files/notes.md")).body, "hello");
  const denied = await read("PUT", "/disks/app/files/notes.md", undefined, "x");
  assert.equal(denied.status, 403);

  const invalid = await api("GET", "/disks/app/commits?limit=ten");
  assert.equal(invalid.status, 400);
  const anonymous = await s.app.request("/v2/whoami");
  assert.equal(anonymous.status, 401);
  assert.match((await anonymous.json()).error.hint, /skywake login/);
  const unscoped = client(s, key);
  assert.equal((await unscoped("GET", "/disks/app")).status, 404);
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
  const sinceCommit = ok(
    await api("GET", `/disks/app/diff?branch=agent-1&against=${first.commit}`),
  );
  assert.deepEqual(sinceCommit.data, [{ path: "b.txt", change: "added" }]);
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
  const main = ok(await api("GET", "/disks/app/branches/main"));
  assert.equal(main.head, settled.commit);
  const listing = ok(await api("GET", "/disks/app/files"));
  assert.equal(listing.data[0].executable, false);
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
  assert.ok(!Object.keys(doc.paths).some((path) => path.startsWith("/indexes")));
});
