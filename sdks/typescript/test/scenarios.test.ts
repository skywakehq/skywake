import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";

import {
  collect,
  Conflict,
  MergeConflict,
  NotFound,
  PermissionError,
  Skywake,
  type Disk,
} from "../dist/index.js";

const URL = process.env.SKYWAKE_SCENARIO_URL;
const ADMIN = process.env.SKYWAKE_SCENARIO_KEY;
const skip = URL && ADMIN ? false : "needs SKYWAKE_SCENARIO_URL and SKYWAKE_SCENARIO_KEY";

const keys = { prod: "", staging: "", read: "" };
let sky: Skywake;

before(async () => {
  if (skip) return;
  const org = new Skywake({ url: URL, key: ADMIN });
  for (const name of ["prod", "staging"]) {
    await org.createEnvironment(name).catch((error) => {
      if (!(error instanceof Conflict)) throw error;
    });
  }
  const made = (name: string, role: "admin" | "read", environment: string) =>
    org.createKey({ name, role, environment }).then((created) => created.key);
  keys.prod = await made("prod", "admin", "prod");
  keys.staging = await made("staging", "admin", "staging");
  keys.read = await made("reader", "read", "prod");
  for (const name of ["SKYWAKE_KEY", "SKYWAKE_ENV", "SKYWAKE_PROFILE"]) delete process.env[name];
  process.env.SKYWAKE_URL = URL;
  process.env.SKYWAKE_API_KEY = keys.prod;
  sky = new Skywake();
});

async function eventually<T>(check: () => Promise<T | undefined>): Promise<T> {
  for (let tries = 0; ; tries++) {
    const found = await check();
    if (found !== undefined || tries === 100) return found as T;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const names = async (items: AsyncIterable<{ name: string }>) =>
  (await collect(items)).map((item) => item.name);

test("1. with only SKYWAKE_API_KEY set, whoami shows the environment", { skip }, async () => {
  const me = await sky.whoami();
  assert.equal(me.environment, "prod");
  assert.equal(me.role, "admin");
});

let app: Disk;

test("2. a file written to a new disk reads back and is listed", { skip }, async () => {
  app = sky.disk("app");
  await app.write("README.md", "# App\n");
  assert.equal(await app.read("README.md"), "# App\n");
  const listed = await app.list();
  assert.deepEqual(
    listed.map((entry) => [entry.path, entry.kind]),
    [["README.md", "file"]],
  );
});

test("3. many files written together are one commit", { skip }, async () => {
  const before = (await collect(app.log())).length;
  await app.write(
    { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n", "notes.txt": "hi" },
    { message: "three files" },
  );
  const log = await collect(app.log());
  assert.equal(log.length, before + 1);
  assert.equal(log[0]!.message, "three files");
});

test("4. both sides changing one file make the merge a MergeConflict", { skip }, async () => {
  const work = await app.fork("agent-1");
  await work.write("notes.txt", "from the agent");
  await app.write("notes.txt", "from main");
  await assert.rejects(work.mergeInto("main"), (error: MergeConflict) => {
    assert.ok(error instanceof MergeConflict);
    assert.deepEqual(error.conflicts, ["notes.txt"]);
    return true;
  });
  const settled = await work.mergeInto("main", { prefer: "theirs" });
  assert.ok(settled.commit);
  assert.equal(await app.read("notes.txt"), "from the agent");
});

test("5. grep, find and query on a disk find a file", { skip }, async () => {
  await app.write("docs/coffee.md", "How to brew coffee at home.\n");
  const lines = await app.grep("brew");
  assert.deepEqual(
    lines.map((line) => [line.path, line.line]),
    [["docs/coffee.md", 1]],
  );
  const found = await app.find("*.md", { path: "docs" });
  assert.deepEqual(
    found.map((entry) => entry.path),
    ["docs/coffee.md"],
  );
  const synced = async () => {
    const hits = await app.query("coffee");
    return hits.some((hit) => hit.path === "docs/coffee.md") ? hits : undefined;
  };
  const hits = await eventually(synced);
  assert.equal(hits[0]?.path, "docs/coffee.md");
});

test("6. read with at returns the old content after a change", { skip }, async () => {
  const old = await app.head();
  await app.write("README.md", "# App, changed\n");
  assert.equal(await app.read("README.md", { at: old! }), "# App\n");
  assert.equal(await app.read("README.md"), "# App, changed\n");
});

test("7. keys stay in their environment and their role", { skip }, async () => {
  const staging = new Skywake({ key: keys.staging, environment: "prod" });
  await assert.rejects(staging.disk("app").read("README.md"), PermissionError);
  const reader = new Skywake({ key: keys.read }).disk("app");
  assert.equal(await reader.read("README.md"), "# App, changed\n");
  await assert.rejects(reader.write("nope.md", "nope"), PermissionError);
});

test("8. a wrong name is NotFound with a suggestion", { skip }, async () => {
  await assert.rejects(sky.disk("ap").read("README.md"), (error: NotFound) => {
    assert.ok(error instanceof NotFound);
    assert.match(error.hint ?? "", /`app`/);
    return true;
  });
});

test(
  "9. destroying a branch, then the disk, empties the lists",
  { skip },
  async () => {
    await app.on("agent-1").destroy();
    assert.deepEqual(
      (await app.branches()).map((branch) => branch.name),
      ["main"],
    );
    await app.destroy();
    assert.deepEqual(await names(sky.listDisks()), []);
  },
);

test("a folder goes up as one commit and comes back the same", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "skywake-up-"));
  writeFileSync(join(dir, "a.txt"), "alpha");
  writeFileSync(join(dir, "b.bin"), new Uint8Array([0, 1, 2, 255]));
  const site = sky.disk("site");
  await site.upload(dir, { message: "site" });
  const back = mkdtempSync(join(tmpdir(), "skywake-down-"));
  await site.download(back);
  assert.equal(readFileSync(join(back, "a.txt"), "utf8"), "alpha");
  assert.deepEqual([...readFileSync(join(back, "b.bin"))], [0, 1, 2, 255]);
  await site.destroy();
});
