import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fakeFiles } from "./fake-files.ts";

async function folder(t: { after: (fn: () => Promise<unknown>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "skywake-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("a folder committed and checked out comes back byte for byte", async (t) => {
  const api = await fakeFiles();
  t.after(api.close);
  const from = await folder(t);
  const binary = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256);
  // Over the size that is sent inline, so it goes up as a part.
  const large = Uint8Array.from({ length: 4 * 1024 * 1024 + 5 }, (_, i) => i % 251);
  const files: Record<string, string | Uint8Array> = {
    "README.md": "# hello\n",
    "src/main.ts": 'console.log("hi")\r\n',
    "src/deep/bom.txt": "﻿keeps its mark",
    "empty.txt": "",
    "image.bin": binary,
    "quotes.txt": '"'.repeat(300),
    "data/large.bin": large,
    "run.sh": "#!/bin/sh\necho hi\n",
    ".git/config": "[core]\n",
    "src/.git": "gitdir: elsewhere\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(from, path, ".."), { recursive: true });
    await writeFile(join(from, path), content);
  }
  await chmod(join(from, "run.sh"), 0o755);

  const main = api.sky.namespace("app").branch("main");
  const head = await main.commitFolder(from, { message: "import" });
  assert.equal(head, "c1");
  assert.equal(api.commits.length, 2, "it fits in one commit");
  assert.ok(api.bodies[0]! < 1024 * 1024, "the large file went up as a part, not inline");
  const tree = api.commits[1]!.tree;
  assert.ok(![...tree.keys()].some((path) => path.includes(".git")));
  assert.deepEqual(
    [...tree].filter(([, entry]) => "executable" in entry && entry.executable).map(([p]) => p),
    ["run.sh"],
  );

  const to = await folder(t);
  assert.equal(await main.checkout(to), "c1");
  for (const [path, content] of Object.entries(files)) {
    if (path.includes(".git")) continue;
    const want = typeof content === "string" ? new TextEncoder().encode(content) : content;
    assert.deepEqual(new Uint8Array(await readFile(join(to, path))), want, path);
  }
  assert.ok(((await stat(join(to, "run.sh"))).mode & 0o111) !== 0, "run.sh stays executable");
  assert.deepEqual((await readdir(to)).sort(), [
    "README.md",
    "data",
    "empty.txt",
    "image.bin",
    "quotes.txt",
    "run.sh",
    "src",
  ]);
});

test("a checkout reads one commit, even after the branch moves on", async (t) => {
  const api = await fakeFiles();
  t.after(api.close);
  const first = api.commit([{ path: "a.txt", text: "one" }]);
  api.commit([
    { path: "a.txt", text: "two" },
    { path: "b.txt", text: "new" },
  ]);
  const to = await folder(t);
  const main = api.sky.namespace("app").branch("main");
  assert.equal(await main.checkout(to, { at: first }), first);
  assert.equal(await readFile(join(to, "a.txt"), "utf8"), "one");
  assert.deepEqual(await readdir(to), ["a.txt"]);
});

test("a folder with more files than a commit takes is split into commits", async (t) => {
  const api = await fakeFiles();
  t.after(api.close);
  const from = await folder(t);
  await Promise.all(
    Array.from({ length: 10_005 }, (_, i) => writeFile(join(from, `f${i}.txt`), `${i}`)),
  );
  const head = await api.sky.namespace("app").branch("main").commitFolder(from, { message: "m" });
  assert.equal(head, "c2");
  assert.deepEqual(
    api.commits.slice(1).map((commit) => [commit.message, commit.changes.length]),
    [
      ["m", 10_000],
      ["m", 5],
    ],
  );
  assert.equal(api.commits[2]!.tree.size, 10_005);
});
