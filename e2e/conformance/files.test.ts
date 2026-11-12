import assert from "node:assert/strict";
import { test } from "node:test";

import { NS, bytes, get, names, post, ready, write } from "./api.ts";

test("files are written, read, listed and searched", async () => {
  const key = await ready();
  const written = await write(key, "main", {
    "src/main.rs": "fn main() {\n    run();\n}\n",
    "README.md": "hi",
  });
  assert.equal(written.status, 201, JSON.stringify(written.body));

  const root = (await get(`${NS}/branches/main/files`, key)).body;
  assert.equal(root.kind, "folder");
  assert.deepEqual(names(root.entries, "name"), ["README.md", "src"]);
  assert.equal((await get(`${NS}/branches/main/files?path=src/main.rs`, key)).body.size, 25);
  const part = await bytes(
    `${NS}/branches/main/files/content?path=src/main.rs&offset=3&length=4`,
    key,
  );
  assert.equal(part.toString(), "main");
  assert.equal((await get(`${NS}/branches/main/files?path=missing`, key)).status, 404);

  const found = await get(
    `${NS}/branches/main/search?pattern=${encodeURIComponent("run\\(\\)")}`,
    key,
  );
  assert.deepEqual(found.body, [{ path: "src/main.rs", line: 2, text: "    run();" }]);
  assert.deepEqual((await get(`${NS}/branches/main/search?pattern=hi&path=src`, key)).body, []);
  assert.equal((await get(`${NS}/branches/main/search?pattern=(`, key)).status, 400);

  // Deleting and writing in one commit.
  const tidy = await post(`${NS}/branches/main/commits`, key, {
    message: "tidy",
    changes: [
      { path: "README.md", delete: true },
      { path: "bin/tool", base64: "AAEC", executable: true },
    ],
  });
  assert.equal(tidy.status, 201);
  assert.deepEqual(
    [...(await bytes(`${NS}/branches/main/files/content?path=bin/tool`, key))],
    [0, 1, 2],
  );
  const both = { message: "bad", changes: [{ path: "a", text: "x", delete: true }] };
  assert.equal((await post(`${NS}/branches/main/commits`, key, both)).status, 400);
  const log = (await get(`${NS}/branches/main/commits`, key)).body;
  assert.deepEqual(names(log, "message"), ["tidy", "write", "empty"]);

  // The versions of one file: written, then deleted.
  const versions = await get(`${NS}/branches/main/files/history?path=README.md`, key);
  assert.equal(versions.status, 200);
  assert.deepEqual(names(versions.body, "message"), ["tidy", "write"]);
  assert.equal(versions.body[0].size, null);
  assert.equal(typeof versions.body[1].size, "number");
});

test("older commits can be read and forked", async () => {
  const key = await ready();
  const first = await write(key, "main", { "a.txt": "one\n" });
  await write(key, "main", { "a.txt": "two\n" });
  const at = first.body.head;

  const old = await bytes(`${NS}/branches/main/files/content?path=a.txt&at=${at}`, key);
  assert.equal(old.toString(), "one\n");
  const fork = await post(`${NS}/branches`, key, { name: "retry", from: "main", at });
  assert.equal(fork.status, 201, JSON.stringify(fork.body));
  assert.equal(fork.body.head, at);
  assert.equal(
    (await bytes(`${NS}/branches/retry/files/content?path=a.txt`, key)).toString(),
    "one\n",
  );

  assert.equal((await get(`${NS}/branches/main/files?at=nope`, key)).status, 400);
  assert.equal((await get(`${NS}/branches/main/files?at=${"0".repeat(64)}`, key)).status, 404);
});
