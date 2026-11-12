import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Engine, EngineError, blake3, validName } from "../index.js";

const text = (content: string) => Buffer.from(content);

test("the engine commits, lists, reads, searches and logs", async () => {
  const engine = Engine.open(mkdtempSync(join(tmpdir(), "skywake-")));
  await engine.createBranch("main");
  const first = await engine.commitFiles("main", "add", [
    { path: "src/main.rs", content: text("fn main() {\n    run();\n}\n") },
    { path: "README.md", content: text("hi") },
  ]);
  await engine.commitFiles("main", "tidy", [{ path: "README.md" }], "session-1");

  const root = await engine.list("main", "");
  assert.equal(root.info.kind, "folder");
  assert.deepEqual(
    root.entries.map((entry) => entry.name),
    ["src"],
  );
  assert.equal((await engine.read("main", "src/main.rs", 3, 4)).toString(), "main");
  assert.equal((await engine.read("main", "README.md", null, null, first)).toString(), "hi");
  await assert.rejects(
    engine.read("main", "README.md"),
    (error: EngineError) => error.kind === "not_found",
  );

  const found = await engine.search("main", "run\\(\\)");
  assert.deepEqual(found, [{ path: "src/main.rs", line: 2, text: "    run();" }]);
  await assert.rejects(
    engine.search("main", "("),
    (error: EngineError) => error.kind === "invalid",
  );

  const log = await engine.log("main");
  assert.deepEqual(
    log.map((commit) => commit.message),
    ["tidy", "add", "empty"],
  );
  assert.equal(log[0]!.session, "session-1");
});

test("a call costs microseconds, not milliseconds", async () => {
  const engine = Engine.open(mkdtempSync(join(tmpdir(), "skywake-")));
  await engine.createBranch("main");
  await engine.commitFiles("main", "add", [{ path: "a", content: text("x") }]);
  const calls = 2000;
  const start = performance.now();
  for (let i = 0; i < calls; i++) await engine.read("main", "a");
  const each = (performance.now() - start) / calls;
  console.log(`read of a small local file: ${(each * 1000).toFixed(0)} µs per call`);
  assert.ok(each < 5, `${each} ms per call`);
});

test("merges, diffs, feeds and file history", async () => {
  const engine = Engine.open(mkdtempSync(join(tmpdir(), "skywake-")));
  await engine.createBranch("main");
  await engine.commitFiles("main", "base", [{ path: "notes", content: text("one\ntwo\n") }]);
  await engine.createBranch("side", "main");
  await engine.commitFiles("side", "edit", [{ path: "notes", content: text("ONE\ntwo\n") }]);

  assert.deepEqual(await engine.diff("main", "side"), [{ kind: "modified", path: "notes" }]);
  assert.deepEqual(await engine.conflicts("main", "side"), []);
  const merged = await engine.merge("main", "side", "merge side");
  assert.ok(merged.head);
  const { commit, changes } = await engine.commit(merged.head);
  assert.equal(commit.merged, await engine.head("side"));
  assert.deepEqual(changes, [{ kind: "modified", path: "notes" }]);

  const feed = await engine.changesSince("main", null, 10);
  assert.deepEqual(
    feed.map((item) => item.commit.message),
    ["empty", "base", "merge side"],
  );
  const versions = await engine.fileHistory("main", "notes");
  assert.deepEqual(
    versions.map((version) => version.size),
    [8, 8],
  );

  const old = await engine.forkAt("old", feed[1]!.commit.hash);
  assert.equal(old, feed[1]!.commit.hash);
  await engine.deleteBranch("old");
  await assert.rejects(engine.head("old"), (error: EngineError) => error.kind === "not_found");
  await assert.rejects(
    engine.createBranch("side"),
    (error: EngineError) => error.kind === "conflict",
  );
  await assert.rejects(
    engine.forkAt("x", "nope"),
    (error: EngineError) => error.kind === "invalid",
  );
});

test("hashes and names", () => {
  assert.equal(blake3(Buffer.from("")).toString("hex").slice(0, 8), "af1349b9");
  assert.ok(validName("agents/fix-1"));
  assert.ok(!validName("a/../b"));
});

test("parts, copies and folders", async () => {
  const engine = Engine.open(mkdtempSync(join(tmpdir(), "skywake-")));
  await engine.createBranch("main");
  const part = Buffer.alloc(3 << 20, 7);
  const chunks = await engine.storePart(part);
  assert.equal(
    chunks.reduce((sum, chunk) => sum + chunk.size, 0),
    part.length,
  );
  const before = Date.now();
  const first = await engine.commitFiles("main", "add", [
    { path: "big", chunks: [...chunks, ...chunks] },
    { path: "empty", folder: true },
  ]);
  await engine.commitFiles("main", "move", [
    { path: "moved", from: { path: "big" } },
    { path: "big" },
  ]);
  await engine.commitFiles("main", "restore", [{ path: "big", from: { path: "big", at: first } }]);

  const root = await engine.list("main", "");
  assert.deepEqual(
    root.entries.map((entry) => [entry.name, entry.kind, entry.size]),
    [
      ["big", "file", 6 << 20],
      ["empty", "folder", 0],
      ["moved", "file", 6 << 20],
    ],
  );
  assert.ok(root.entries[0]!.modified >= before - 1000);
  assert.equal(root.entries[1]!.modified, 0);
  assert.equal((await engine.read("main", "moved", (3 << 20) - 2, 4)).length, 4);
  await assert.rejects(
    engine.commitFiles("main", "bad", [{ path: "x", from: { path: "nope" } }]),
    (error: EngineError) => error.kind === "invalid",
  );
  await assert.rejects(
    engine.commitFiles("main", "bad", [{ path: "x", content: text("x"), folder: true }]),
    (error: EngineError) => error.kind === "invalid",
  );
});
