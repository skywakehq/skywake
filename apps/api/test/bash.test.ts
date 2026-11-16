import assert from "node:assert/strict";
import { test } from "node:test";

import { createShell, type Shell } from "skywake/bash";
import { Skywake } from "@skywake/sdk";

import { server, skip, type Server } from "./helpers.ts";

const NS = "/namespaces/prod%2Fapp";

function shell(s: Server, key: string) {
  const asked: string[] = [];
  const client = new Skywake({
    url: "http://api.test",
    key,
    fetch: (input, init) => {
      const request = new Request(input, init);
      asked.push(new URL(request.url).pathname.split("/").pop()!);
      return Promise.resolve(s.app.fetch(request));
    },
  });
  return { sh: createShell(client.namespace("prod/app").branch("main")), asked };
}

async function seeded() {
  const s = await server();
  const { key } = await s.ready();
  const changes = [
    { path: "src/app.ts", text: "export function greet() {}\n" },
    { path: "src/lib/util.ts", text: "const x = 1;\ngreet();\n" },
    { path: "docs/readme.md", text: "# Readme\n" },
  ];
  const done = await s.call("POST", `${NS}/branches/main/commits`, key, {
    message: "seed",
    changes,
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  return { s, key, ...shell(s, key) };
}

async function out(sh: Shell, command: string) {
  const ran = await sh.bash.exec(command);
  return { stdout: ran.stdout, stderr: ran.stderr, code: ran.exitCode };
}

test("bash reads a branch like a disk", { skip }, async () => {
  const { sh } = await seeded();
  assert.equal((await out(sh, "ls /src")).stdout, "app.ts\nlib\n");
  assert.equal((await out(sh, "cat src/lib/util.ts | wc -l")).stdout.trim(), "2");
  assert.equal((await out(sh, "head -1 docs/readme.md")).stdout, "# Readme\n");
});

test("rg, grep -r and find run on the server", { skip }, async () => {
  const { sh, asked } = await seeded();
  assert.deepEqual((await out(sh, "rg -n greet")).stdout.split("\n").filter(Boolean).sort(), [
    "src/app.ts:1:export function greet() {}",
    "src/lib/util.ts:2:greet();",
  ]);
  assert.equal((await out(sh, "cd src/lib && rg -l greet")).stdout, "util.ts\n");
  assert.equal(
    (await out(sh, "grep -rn 'greet()' src/lib")).stdout,
    "src/lib/util.ts:2:greet();\n",
  );
  assert.equal((await out(sh, "grep -rl 'func\\|nothing' .")).stdout, "./src/app.ts\n");
  assert.equal((await out(sh, "rg -g '*.md' -i README")).stdout, "docs/readme.md:# Readme\n");
  assert.equal((await out(sh, "rg absent")).code, 1);
  assert.equal((await out(sh, "rg '('")).code, 2);
  assert.equal((await out(sh, "find . -name '*.ts'")).stdout, "./src/app.ts\n./src/lib/util.ts\n");
  assert.equal((await out(sh, "find src -type d")).stdout, "src\nsrc/lib\n");
  assert.equal(asked.filter((route) => route === "search").length, 7);
  assert.equal(asked.filter((route) => route === "find").length, 2);
});

test("writes stay pending until committed, as one commit", { skip }, async () => {
  const { s, key, sh } = await seeded();
  const script = [
    "echo hi > notes.txt",
    "mkdir -p a/b",
    "mv src/lib a/b/lib",
    "rm docs/readme.md",
    "cp src/app.ts src/copy.ts",
  ].join(" && ");
  assert.equal((await out(sh, script)).code, 0);
  assert.equal((await out(sh, "cat notes.txt")).stdout, "hi\n");
  assert.equal((await out(sh, "ls a/b/lib")).stdout, "util.ts\n");
  assert.equal((await out(sh, "ls src")).stdout, "app.ts\ncopy.ts\n");
  assert.deepEqual((await out(sh, "rg -l greet")).stdout.split("\n").filter(Boolean).sort(), [
    "a/b/lib/util.ts",
    "src/app.ts",
    "src/copy.ts",
  ]);
  const before = await s.call("GET", `${NS}/branches/main/files?path=notes.txt`, key);
  assert.equal(before.status, 404);

  const head = await sh.fs.commit("bash");
  assert.ok(head);
  const exists = async (path: string) =>
    (await s.call("GET", `${NS}/branches/main/files?path=${encodeURIComponent(path)}`, key))
      .status === 200;
  assert.equal(await exists("notes.txt"), true);
  assert.equal(await exists("a/b/lib/util.ts"), true);
  assert.equal(await exists("src/copy.ts"), true);
  assert.equal(await exists("src/lib"), false);
  assert.equal(await exists("docs/readme.md"), false);
  assert.equal(await sh.fs.commit("nothing"), null);
  assert.equal((await out(sh, "rg -l greet a")).stdout, "a/b/lib/util.ts\n");
});

test("a folder replaced by a new one loses what it held", { skip }, async () => {
  const { s, key, sh } = await seeded();
  assert.equal((await out(sh, "rm -r src && mkdir src && echo new > src/new.ts")).code, 0);
  assert.equal((await out(sh, "ls src")).stdout, "new.ts\n");
  await sh.fs.commit("replace");
  const listed = await s.call("GET", `${NS}/branches/main/files?path=src`, key);
  assert.deepEqual(
    listed.body.entries.map((e: { name: string }) => e.name),
    ["new.ts"],
  );
});
