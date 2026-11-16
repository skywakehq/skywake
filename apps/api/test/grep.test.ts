import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { Engine } from "@skywake/engine";

import { gramsOf, neededGrams } from "../src/features/links/grams.ts";
import { server, skip, type Server } from "./helpers.ts";

const NS = "/namespaces/prod%2Fapp";

const hex = (text: string) => gramsOf(text).split(" ");

test("a pattern needs the trigrams of the text every match holds", () => {
  assert.deepEqual(neededGrams("hello"), [hex("hello")]);
  assert.deepEqual(neededGrams("HeLLo"), [hex("hello")]);
  assert.deepEqual(
    neededGrams("foo.*barbaz")!.map((g) => g.sort()),
    [[...hex("foo"), ...hex("barbaz")].sort()],
  );
  assert.deepEqual(neededGrams("alpha|omega"), [hex("alpha"), hex("omega")]);
  assert.deepEqual(neededGrams("colou?r"), [hex("colo")]);
  assert.deepEqual(neededGrams("a\\.b\\.c"), [hex("a.b.c")]);
  assert.deepEqual(neededGrams("(?:needle)s?"), [hex("needle")]);
  assert.deepEqual(neededGrams("x(needle)?"), null);
  assert.equal(neededGrams(".*"), null);
  assert.equal(neededGrams("\\w+\\d"), null);
  assert.equal(neededGrams("ab|abcdef"), null);
  assert.deepEqual(neededGrams("fun[ck]tion")![0]!.sort(), [...hex("fun"), ...hex("tion")].sort());
});

test("every match of a pattern holds the trigrams it needs", () => {
  const cases: [string, string][] = [
    ["export function main", "export\\s+function\\s+\\w+"],
    ["const colour = 1", "colou?r"],
    ["TODO(sam): fix", "todo\\(\\w+\\)"],
    ["a.b.c", "a\\.b\\.c"],
    ["omega", "alpha|omega"],
    ["needles", "(?:needle)s?"],
    ["x = foo123bar", "foo\\d+bar"],
  ];
  for (const [text, pattern] of cases) {
    assert.ok(new RegExp(pattern, "i").test(text), `${pattern} should match ${text}`);
    const held = new Set(hex(text));
    const ways = neededGrams(pattern);
    assert.ok(ways, pattern);
    assert.ok(
      ways.some((grams) => grams.every((gram) => held.has(gram))),
      `${pattern} needs a trigram ${text} lacks`,
    );
  }
});

async function linked(s: Server) {
  const { id, key } = await s.ready();
  const made = await s.call("PUT", `${NS}/index`, key, { index: "prod/files" });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  return { id, key };
}

async function commit(s: Server, key: string, changes: object[]) {
  const done = await s.call("POST", `${NS}/branches/main/commits`, key, {
    message: "change",
    changes,
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  return done.body.head as string;
}

async function grep(s: Server, key: string, query: Record<string, string>) {
  const found = await s.call(
    "GET",
    `${NS}/branches/main/search?${new URLSearchParams(query)}`,
    key,
  );
  assert.equal(found.status, 200, JSON.stringify(found.body));
  const lines = found.body.map((m: { path: string; line: number }) => `${m.path}:${m.line}`);
  return { lines: lines.sort(), searched: found.headers.get("skywake-searched") };
}

test("find matches paths by glob without reading files", { skip }, async () => {
  const s = await server();
  const { key } = await s.ready();
  await commit(s, key, [
    { path: "src/app.ts", text: "x" },
    { path: "src/lib/util.ts", text: "x" },
    { path: "src/lib/util.test.ts", text: "x" },
    { path: "docs/readme.md", text: "x" },
  ]);
  const find = async (query: Record<string, string>) => {
    const got = await s.call("GET", `${NS}/branches/main/find?${new URLSearchParams(query)}`, key);
    assert.equal(got.status, 200, JSON.stringify(got.body));
    return got.body.map((f: { path: string }) => f.path);
  };
  assert.deepEqual(await find({ glob: "*.ts" }), [
    "src/app.ts",
    "src/lib/util.test.ts",
    "src/lib/util.ts",
  ]);
  assert.deepEqual(await find({ glob: "src/**/*.test.ts" }), ["src/lib/util.test.ts"]);
  assert.deepEqual(await find({ glob: "*", kind: "folders" }), ["docs", "src", "src/lib"]);
  assert.deepEqual(await find({ glob: "*.md", path: "docs" }), ["docs/readme.md"]);
  const bad = await s.call("GET", `${NS}/branches/main/find?glob=%5Babc`, key);
  assert.equal(bad.status, 400);
});

test("search scans a branch with no index, with globs and any case", { skip }, async () => {
  const s = await server();
  const { key } = await s.ready();
  await commit(s, key, [
    { path: "a.ts", text: "const Needle = 1;" },
    { path: "b.md", text: "a needle" },
  ]);
  assert.deepEqual(await grep(s, key, { pattern: "needle" }), {
    lines: ["b.md:1"],
    searched: "scan",
  });
  assert.deepEqual(await grep(s, key, { pattern: "needle", ignoreCase: "true" }), {
    lines: ["a.ts:1", "b.md:1"],
    searched: "scan",
  });
  assert.deepEqual(
    (await grep(s, key, { pattern: "needle", glob: "*.ts", ignoreCase: "true" })).lines,
    ["a.ts:1"],
  );
});

test(
  "search on a linked branch reads only files that can match, and sees unsynced changes",
  { skip },
  async () => {
    const s = await server();
    const { key } = await linked(s);
    const old = await commit(s, key, [
      { path: "src/server.ts", text: "export function handleRequest() {}\n// giraffe" },
      { path: "src/client.ts", text: "export function sendRequest() {}" },
      { path: "docs/guide.md", text: "the giraffe guide" },
    ]);
    await s.services.syncer.drain();

    assert.deepEqual(await grep(s, key, { pattern: "giraffe" }), {
      lines: ["docs/guide.md:1", "src/server.ts:2"],
      searched: "index",
    });
    assert.deepEqual(await grep(s, key, { pattern: "function \\w+Request" }), {
      lines: ["src/client.ts:1", "src/server.ts:1"],
      searched: "index",
    });
    assert.deepEqual((await grep(s, key, { pattern: "giraffe", path: "src" })).lines, [
      "src/server.ts:2",
    ]);
    assert.equal((await grep(s, key, { pattern: "\\w+" })).searched, "scan");

    await commit(s, key, [
      { path: "docs/guide.md", delete: true },
      { path: "notes/new.txt", text: "a fresh giraffe" },
      { path: "src/server.ts", text: "export function handleRequest() {}" },
    ]);
    assert.deepEqual(await grep(s, key, { pattern: "giraffe" }), {
      lines: ["notes/new.txt:1"],
      searched: "index",
    });
    const then = { lines: ["docs/guide.md:1", "src/server.ts:2"], searched: "index" };
    assert.deepEqual(await grep(s, key, { pattern: "giraffe", at: old }), then);
    await s.services.syncer.drain();
    assert.deepEqual(await grep(s, key, { pattern: "giraffe", at: old }), then);
  },
);

test("search on a linked branch also sees what was written around the API", { skip }, async () => {
  const s = await server();
  const { id, key } = await linked(s);
  await s.services.syncer.drain();
  const ns = (await s.services.db.query.namespaces.findFirst({
    where: (t, { and, eq }) => and(eq(t.org, id), eq(t.name, "prod/app")),
  }))!;
  const engine = await Engine.open(join(s.store, ns.region, ns.folder));
  await engine.commitFiles("main", "direct", [
    { path: "deep/folder/x.txt", content: Buffer.from("a zebra here") },
  ]);
  assert.deepEqual(await grep(s, key, { pattern: "zebra" }), {
    lines: ["deep/folder/x.txt:1"],
    searched: "index",
  });
});
