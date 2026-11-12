import assert from "node:assert/strict";
import { test } from "node:test";

import { server, skip } from "./helpers.ts";

const NS = "/namespaces/prod%2Fapp";
const MAIN = `${NS}/branches/main`;

async function setup() {
  const s = await server();
  const { key } = await s.ready();
  const call = async (method: string, path: string, body?: unknown) =>
    s.call(method, path, key, body);
  const commit = async (branch: string, changes: unknown[], message = "change") => {
    const answer = await call("POST", `${NS}/branches/${branch}/commits`, { message, changes });
    assert.equal(answer.status, 201, JSON.stringify(answer.body));
    return answer.body.head as string;
  };
  const read = async (branch: string, path: string) => {
    const answer = await call("GET", `${NS}/branches/${branch}/files/content?path=${path}`);
    return answer.status === 200 ? (answer.body as unknown as string) : null;
  };
  return { s, key, call, commit, read };
}

test("a revert puts back what one commit changed, as a new commit", { skip }, async () => {
  const { call, commit, read } = await setup();
  const bad = await commit(
    "main",
    [
      { path: "a.txt", text: "broken" },
      { path: "new/file.txt", text: "x" },
    ],
    "break things",
  );
  await commit("main", [{ path: "b.txt", text: "later" }]);

  const reverted = await call("POST", `${MAIN}/revert`, { commit: bad });
  assert.equal(reverted.status, 201, JSON.stringify(reverted.body));
  assert.equal(reverted.body.changed, true);
  assert.equal(await read("main", "a.txt"), "hello");
  assert.equal(await read("main", "new/file.txt"), null);
  assert.equal(await read("main", "b.txt"), "later");
  const [last] = (await call("GET", `${MAIN}/commits?limit=1`)).body;
  assert.equal(last.message, 'Revert "break things"');

  // Reverting it again finds the branch changed those paths since.
  const again = await call("POST", `${MAIN}/revert`, { commit: bad });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "conflict");
  assert.deepEqual(again.body.conflicts.sort(), ["a.txt", "new"]);
});

test("a revert refuses to undo paths changed again since", { skip }, async () => {
  const { call, commit, read } = await setup();
  const first = await commit("main", [{ path: "a.txt", text: "two" }]);
  await commit("main", [{ path: "a.txt", text: "three" }]);
  const answer = await call("POST", `${MAIN}/revert`, { commit: first });
  assert.equal(answer.status, 409);
  assert.deepEqual(answer.body.conflicts, ["a.txt"]);
  assert.equal(await read("main", "a.txt"), "three");

  const missing = await call("POST", `${MAIN}/revert`, { commit: "0".repeat(64) });
  assert.equal(missing.status, 404);
});

test("a reset makes the files what they were at a commit", { skip }, async () => {
  const { call, commit, read } = await setup();
  const [start] = (await call("GET", `${MAIN}/commits?limit=1`)).body;
  await commit("main", [
    { path: "a.txt", text: "changed" },
    { path: "dir/b.txt", text: "added" },
  ]);
  await commit("main", [{ path: "a.txt", delete: true }]);

  const reset = await call("POST", `${MAIN}/reset`, { to: start.hash, message: "back" });
  assert.equal(reset.status, 201, JSON.stringify(reset.body));
  assert.equal(await read("main", "a.txt"), "hello");
  assert.equal(await read("main", "dir/b.txt"), null);
  const listing = (await call("GET", `${MAIN}/files`)).body;
  assert.deepEqual(
    listing.entries.map((entry: { name: string }) => entry.name),
    ["a.txt"],
  );
  // The history stays.
  const log = (await call("GET", `${MAIN}/commits`)).body;
  assert.equal(log[0].message, "back");
  assert.equal(log.length, 5);

  const same = await call("POST", `${MAIN}/reset`, { to: start.hash });
  assert.equal(same.status, 200);
  assert.equal(same.body.changed, false);
});

test("a protected branch can't be reverted or reset", { skip }, async () => {
  const { call, commit } = await setup();
  const head = await commit("main", [{ path: "a.txt", text: "two" }]);
  assert.equal((await call("PATCH", MAIN, { protected: true })).status, 204);
  assert.equal((await call("POST", `${MAIN}/revert`, { commit: head })).status, 403);
  assert.equal((await call("POST", `${MAIN}/reset`, { to: head })).status, 403);
});

test("a conflicted merge lands once resolved, with both parents", { skip }, async () => {
  const { call, commit, read } = await setup();
  await commit("main", [
    { path: "b.txt", text: "base" },
    { path: "c.txt", text: "base" },
  ]);
  await call("POST", `${NS}/branches`, { name: "fix", from: "main" });
  for (const [branch, text] of [
    ["main", "ours"],
    ["fix", "theirs"],
  ]) {
    await commit(branch!, [
      { path: "a.txt", text },
      { path: "b.txt", text },
      { path: "c.txt", text },
    ]);
  }
  const merge = { from: "fix", into: "main" };

  const conflicted = await call("POST", `${NS}/merges`, merge);
  assert.equal(conflicted.status, 409);
  assert.deepEqual(conflicted.body.conflicts, ["a.txt", "b.txt", "c.txt"]);

  const resolve = [
    { path: "a.txt", take: "ours" },
    { path: "b.txt", take: "theirs" },
  ];
  const dry = await call("POST", `${NS}/merges`, { ...merge, resolve, dry_run: true });
  assert.deepEqual(dry.body.conflicts, ["c.txt"]);
  const partial = await call("POST", `${NS}/merges`, { ...merge, resolve });
  assert.equal(partial.status, 409);
  assert.deepEqual(partial.body.conflicts, ["c.txt"]);

  const both = Buffer.from("both").toString("base64");
  const landed = await call("POST", `${NS}/merges`, {
    ...merge,
    resolve: [...resolve, { path: "c.txt", base64: both }],
  });
  assert.equal(landed.status, 200, JSON.stringify(landed.body));
  assert.equal(await read("main", "a.txt"), "ours");
  assert.equal(await read("main", "b.txt"), "theirs");
  assert.equal(await read("main", "c.txt"), "both");
  const [last] = (await call("GET", `${MAIN}/commits?limit=1`)).body;
  assert.equal(last.hash, landed.body.head);
  assert.equal(last.merged, (await call("GET", `${NS}/branches/fix`)).body.head);

  const bad = await call("POST", `${NS}/merges`, {
    ...merge,
    resolve: [{ path: "a.txt", take: "ours", text: "x" }],
  });
  assert.equal(bad.status, 400);
});

test("a branch tells where it forked, and diffs from there", { skip }, async () => {
  const { call, commit } = await setup();
  const fork = (await call("GET", MAIN)).body.head;
  await call("POST", `${NS}/branches`, { name: "fix", from: "main" });
  await commit("main", [{ path: "main.txt", text: "m" }]);
  await commit("fix", [{ path: "fix.txt", text: "f" }]);

  const info = (await call("GET", `${NS}/branches/fix`)).body;
  assert.equal(info.base, fork);
  assert.equal((await call("GET", MAIN)).body.base, null);

  const paths = async (query: string) =>
    (await call("GET", `${NS}/branches/fix/diff?from=main${query}`)).body.map(
      (change: { kind: string; path: string }) => `${change.kind} ${change.path}`,
    );
  assert.deepEqual(await paths(""), ["added fix.txt", "removed main.txt"]);
  assert.deepEqual(await paths("&against=base"), ["added fix.txt"]);

  // Once main is merged in, the base moves to it.
  assert.equal((await call("POST", `${NS}/merges`, { from: "main", into: "fix" })).status, 200);
  const moved = (await call("GET", `${NS}/branches/fix`)).body;
  assert.equal(moved.base, (await call("GET", MAIN)).body.head);

  await call("DELETE", MAIN);
  assert.equal((await call("GET", `${NS}/branches/fix`)).body.base, null);
});
