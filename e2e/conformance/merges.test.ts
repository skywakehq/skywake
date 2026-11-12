import assert from "node:assert/strict";
import { test } from "node:test";

import { NS, bytes, call, get, key as newKey, names, post, ready, write } from "./api.ts";

test("protected branches change only by merge", async () => {
  const key = await ready();
  await write(key, "main", { notes: "one\ntwo\nthree\n" });
  await post(`${NS}/branches`, key, { name: "agents/1", from: "main" });
  await post(`${NS}/branches`, key, { name: "agents/2", from: "main" });
  assert.equal((await call("PATCH", `${NS}/branches/main`, key, { protected: true })).status, 204);

  assert.equal((await write(key, "main", { notes: "x" })).status, 403);
  assert.equal((await call("DELETE", `${NS}/branches/main`, key)).status, 403);

  await write(key, "agents/1", { notes: "ONE\ntwo\nthree\n" });
  await write(key, "agents/2", { notes: "one\ntwo\nTHREE\n", new: "n" });
  const changed = [
    { kind: "added", path: "new" },
    { kind: "modified", path: "notes" },
  ];
  assert.deepEqual((await get(`${NS}/branches/agents%2F2/diff?from=main`, key)).body, changed);

  const writer = await newKey(key, "write", "*");
  const refused = await post(`${NS}/merges`, writer, { from: "agents/1", into: "main" });
  assert.equal(refused.status, 403, "only an admin merges into a protected branch");

  const merge = (from: string) => post(`${NS}/merges`, key, { from, into: "main" });
  assert.equal((await merge("agents/1")).status, 200);
  assert.equal((await merge("agents/2")).status, 200);
  assert.equal(
    (await bytes(`${NS}/branches/main/files/content?path=notes`, key)).toString(),
    "ONE\ntwo\nTHREE\n",
  );

  // A conflict saves nothing and names the path.
  await post(`${NS}/branches`, key, { name: "agents/3", from: "agents/1" });
  await write(key, "agents/3", { notes: "ONE\ntwo\ntres\n" });
  const conflict = await merge("agents/3");
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body.conflicts, ["notes"]);

  // The feed shows each commit since a given one, oldest first.
  const feed = (await get(`${NS}/branches/main/changes?limit=3`, key)).body;
  assert.deepEqual(names(feed, "message"), [
    "write",
    "Merge agents/1 into main",
    "Merge agents/2 into main",
  ]);
  const newer = (await get(`${NS}/branches/main/changes?since=${feed[1].hash}`, key)).body;
  assert.deepEqual(names(newer, "message"), ["Merge agents/2 into main"]);
  assert.deepEqual(newer[0].changes, changed);
});

test("a dry run lists conflicts and saves nothing", async () => {
  const key = await ready();
  await write(key, "main", { "a.txt": "base\n" });
  await post(`${NS}/branches`, key, { name: "side", from: "main" });
  await write(key, "main", { "a.txt": "ours\n" });
  await write(key, "side", { "a.txt": "theirs\n" });

  const result = await post(`${NS}/merges`, key, { into: "main", from: "side", dry_run: true });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { head: null, conflicts: ["a.txt"] });
  assert.equal((await get(`${NS}/branches/main/commits`, key)).body.length, 3, "nothing was saved");
});
