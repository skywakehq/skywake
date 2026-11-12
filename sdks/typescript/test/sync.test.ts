import assert from "node:assert/strict";
import { test } from "node:test";

import { syncIndex } from "../dist/index.js";
import { fakeFiles } from "./fake-files.ts";

test("an index follows a branch: upserts what changed, deletes what went", async (t) => {
  const api = await fakeFiles();
  t.after(api.close);
  const main = api.sky.namespace("app").branch("main");
  const index = api.sky.index("docs");
  api.commit([
    { path: "a.md", text: "alpha" },
    { path: "docs/b.md", text: "beta" },
    { path: "docs/deep/c.md", text: "gamma" },
    { path: "logo.png", base64: btoa("\x89PNG\xff\xfe") },
  ]);

  // The first sync loads everything; files that are not text are left out.
  const first = await syncIndex(main, index);
  assert.deepEqual(first, { head: "c1", upserted: 3, deleted: 0 });
  assert.deepEqual([...api.documents.keys()].sort(), ["a.md", "docs/b.md", "docs/deep/c.md"]);
  assert.deepEqual(api.documents.get("a.md"), {
    id: "a.md",
    attributes: { path: "a.md", text: "alpha" },
  });

  api.commit([{ path: "a.md", text: "alpha 2" }]);
  api.commit([
    { path: "docs", delete: true },
    { path: "e.md", text: "epsilon" },
  ]);
  api.commit([{ path: "docs/b.md", text: "beta again" }]);
  const second = await syncIndex(main, index, { since: first.head });
  assert.deepEqual(second, { head: "c4", upserted: 3, deleted: 1 });
  assert.deepEqual([...api.documents.keys()].sort(), ["a.md", "docs/b.md", "e.md"]);
  assert.equal(api.documents.get("a.md").attributes.text, "alpha 2");
  assert.equal(api.documents.get("docs/b.md").attributes.text, "beta again");

  assert.deepEqual(await syncIndex(main, index, { since: second.head }), {
    head: "c4",
    upserted: 0,
    deleted: 0,
  });
});

test("the caller maps files to documents, and a file mapped to null is deleted", async (t) => {
  const api = await fakeFiles();
  t.after(api.close);
  const main = api.sky.namespace("app").branch("main");
  const index = api.sky.index("docs");
  api.commit([
    { path: "notes/a.md", text: "# A" },
    { path: "notes/b.txt", text: "b" },
  ]);
  const options = {
    id: (path: string) => `file:${path}`,
    document: ({ path, bytes }: { path: string; bytes: Uint8Array }) =>
      path.endsWith(".md") ? { id: `file:${path}`, attributes: { size: bytes.length } } : null,
  };
  const first = await syncIndex(main, index, options);
  assert.deepEqual([...api.documents.keys()], ["file:notes/a.md"]);
  api.commit([{ path: "notes/a.md", text: "now plain" }]);
  api.commit([
    { path: "notes/a.md", delete: true },
    { path: "notes/a.txt", text: "x" },
  ]);
  const second = await syncIndex(main, index, { ...options, since: first.head });
  assert.equal(second.deleted, 1);
  assert.equal(api.documents.size, 0);
});

test("after more commits than one feed holds, it compares whole trees", async (t) => {
  const api = await fakeFiles();
  t.after(api.close);
  const main = api.sky.namespace("app").branch("main");
  const index = api.sky.index("docs");
  api.commit([
    { path: "old.md", text: "old" },
    { path: "keep.md", text: "keep" },
  ]);
  const first = await syncIndex(main, index);
  api.commit([{ path: "old.md", delete: true }]);
  for (let i = 0; i < 1000; i++) api.commit([{ path: "keep.md", text: `keep ${i}` }]);
  const second = await syncIndex(main, index, { since: first.head });
  assert.deepEqual(second, { head: "c1002", upserted: 1, deleted: 1 });
  assert.deepEqual([...api.documents.keys()], ["keep.md"]);
  assert.equal(api.documents.get("keep.md").attributes.text, "keep 999");
});
