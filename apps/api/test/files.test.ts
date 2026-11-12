import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";

import { server, skip } from "./helpers.ts";

const MiB = 1024 * 1024;
const NS = "/namespaces/prod%2Fapp";
const BRANCH = `${NS}/branches/main`;

/** Bytes that do not repeat, so they cut into several chunks. */
function noise(length: number, seed: number) {
  const bytes = Buffer.alloc(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    bytes[i] = state >>> 24;
  }
  return bytes;
}

async function setup() {
  const s = await server({ bodyLimit: 32 * MiB });
  const { id, key } = await s.ready();
  const upload = async (bytes: Buffer) => {
    const response = await s.app.request(`/v1${NS}/uploads`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const commit = (...changes: unknown[]) =>
    s.call("POST", `${BRANCH}/commits`, key, { message: "change", changes });
  const read = async (path: string, query = "") => {
    const response = await s.app.request(
      `/v1${BRANCH}/files/content?path=${encodeURIComponent(path)}${query}`,
      { headers: { authorization: `Bearer ${key}` } },
    );
    return Buffer.from(await response.arrayBuffer());
  };
  const list = async (path = "") =>
    (await s.call("GET", `${BRANCH}/files?path=${encodeURIComponent(path)}`, key)).body;
  return { s, id, key, upload, commit, read, list };
}

test("parts upload, join into one file, and read back in ranges", { skip }, async () => {
  const { upload, commit, read, list } = await setup();
  const one = noise(5 * MiB, 1);
  const two = noise(MiB + 7, 2);
  const first = await upload(one);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.size, one.length);
  assert.match(first.body.part, /^[0-9a-f]{64}$/);
  // The same bytes again are the same part.
  assert.deepEqual((await upload(one)).body, first.body);
  const second = (await upload(two)).body;

  const before = Date.now();
  const committed = await commit({
    path: "videos/big.bin",
    parts: [first.body.part, second.part],
    executable: true,
  });
  assert.equal(committed.status, 201, JSON.stringify(committed.body));

  const whole = Buffer.concat([one, two]);
  const [entry] = (await list("videos")).entries;
  assert.equal(entry.size, whole.length);
  assert.equal(entry.executable, true);
  assert.ok(entry.modified >= before - 1000 && entry.modified <= Date.now());
  assert.deepEqual(
    await read("videos/big.bin", `&offset=${5 * MiB - 10}&length=20`),
    whole.subarray(5 * MiB - 10, 5 * MiB + 10),
  );
  assert.deepEqual(await read("videos/big.bin", `&offset=${whole.length - 3}`), whole.subarray(-3));
  assert.deepEqual(await read("videos/big.bin"), whole);
});

test("a part over 16 MiB is refused", { skip }, async () => {
  const { upload } = await setup();
  const { status, body } = await upload(Buffer.alloc(16 * MiB + 1));
  assert.equal(status, 413);
  assert.equal(body.error, "a part holds at most 16 MiB");
});

test("a part over 16 MiB is refused before the rest is read", { skip }, async () => {
  const { s, key } = await setup();
  let sent = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (sent >= 30 * MiB) return controller.close();
      sent += MiB;
      controller.enqueue(new Uint8Array(MiB));
    },
  });
  const response = await s.app.request(`/v1${NS}/uploads`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/octet-stream" },
    body,
    duplex: "half",
  } as RequestInit);
  assert.equal(response.status, 413);
  assert.equal(((await response.json()) as any).error, "a part holds at most 16 MiB");
  assert.ok(sent <= 18 * MiB, `${sent / MiB} MiB read`);
});

test("an unknown or expired part is refused", { skip }, async () => {
  const { s, id, upload, commit } = await setup();
  const unknown = "0".repeat(64);
  const missing = await commit({ path: "a.bin", parts: [unknown] });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, `upload part ${unknown} not found`);

  const { part } = (await upload(Buffer.from("old"))).body;
  await s.db.execute(
    sql`UPDATE api.upload_parts SET created_at = now() - interval '8 days' WHERE org = ${id}`,
  );
  const expired = await commit({ path: "a.bin", parts: [part] });
  assert.equal(expired.body.error, `upload part ${part} not found`);
});

test("files and folders are renamed by copy and delete", { skip }, async () => {
  const { commit, read, list } = await setup();
  await commit({ path: "docs/one.md", text: "one" }, { path: "docs/deep/two.md", text: "two" });

  const renamed = await commit(
    { path: "notes", from: { path: "docs" } },
    { path: "docs", delete: true },
    { path: "b.txt", from: { path: "a.txt" } },
    { path: "a.txt", delete: true },
  );
  assert.equal(renamed.status, 201, JSON.stringify(renamed.body));
  assert.deepEqual(
    (await list()).entries.map((entry: any) => entry.name),
    ["b.txt", "notes"],
  );
  assert.equal((await read("b.txt")).toString(), "hello");
  assert.equal((await read("notes/deep/two.md")).toString(), "two");

  const missing = await commit({ path: "c.txt", from: { path: "nope" } });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /nope/);
});

test("an old version is restored from its commit", { skip }, async () => {
  const { commit, read } = await setup();
  const old = (await commit({ path: "a.txt", text: "first" })).body.head;
  await commit({ path: "a.txt", text: "second" });
  const restored = await commit({ path: "a.txt", from: { path: "a.txt", at: old } });
  assert.equal(restored.status, 201, JSON.stringify(restored.body));
  assert.equal((await read("a.txt")).toString(), "first");
});

test("empty folders are made and listed", { skip }, async () => {
  const { commit, list } = await setup();
  assert.equal((await commit({ path: "empty/inner", folder: true })).status, 201);
  // Again is fine, and changes nothing, so no commit is made.
  assert.equal((await commit({ path: "empty/inner", folder: true })).status, 200);
  const root = (await list()).entries;
  assert.deepEqual(
    root.map((entry: any) => [entry.name, entry.kind, entry.modified]),
    [
      ["a.txt", "file", root[0].modified],
      ["empty", "folder", 0],
    ],
  );
  assert.deepEqual(
    (await list("empty")).entries.map((entry: any) => entry.name),
    ["inner"],
  );
  assert.deepEqual((await list("empty/inner")).entries, []);

  const both = await commit({ path: "x", folder: true, text: "x" });
  assert.equal(both.status, 400);
});

test("the same file again makes no commit", { skip }, async () => {
  const { commit } = await setup();
  const first = await commit({ path: "a.txt", text: "a" });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.changed, true);
  const again = await commit({ path: "a.txt", text: "a" });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(again.body, { head: first.body.head, changed: false });
});

test("large files are read from the store a piece at a time", { skip }, async () => {
  const { s, upload, commit, read } = await setup();
  const one = noise(6 * MiB, 3);
  const two = noise(5 * MiB, 4);
  const parts = [(await upload(one)).body.part, (await upload(two)).body.part];
  assert.equal((await commit({ path: "big.bin", parts })).status, 201);

  const lengths: unknown[] = [];
  const stores = s.services.stores;
  const open = stores.engine.bind(stores);
  stores.engine = (region, folder) => {
    const engine = open(region, folder);
    return new Proxy(engine, {
      get(target, name) {
        if (name === "read") {
          return (...args: Parameters<typeof engine.read>) => {
            lengths.push(args[3]);
            return target.read(...args);
          };
        }
        const value = Reflect.get(target, name);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };

  const whole = Buffer.concat([one, two]);
  assert.deepEqual(await read("big.bin"), whole);
  assert.ok(lengths.length >= 3, `${lengths.length} reads`);
  for (const length of lengths) {
    assert.ok(typeof length === "number" && length <= 4 * MiB, `read of ${length} bytes`);
  }
  assert.deepEqual(
    await read("big.bin", `&offset=${MiB}&length=${9 * MiB}`),
    whole.subarray(MiB, 10 * MiB),
  );
  assert.deepEqual(await read("big.bin", `&offset=${whole.length + 5}`), Buffer.alloc(0));
});

test("edits racing on one file conflict with 409, never 500", { skip }, async () => {
  const { s, key } = await setup();
  const writers = Array.from({ length: 12 }, (_, i) =>
    s.call("POST", `${BRANCH}/commits`, key, {
      message: `writer ${i}`,
      changes: [{ path: "shared.md", text: `from ${i}` }],
    }),
  );
  const answers = await Promise.all(writers);
  const statuses = answers.map((answer) => answer.status);
  assert.ok(statuses.includes(201), JSON.stringify(statuses));
  for (const answer of answers.filter((answer) => answer.status !== 201)) {
    assert.equal(answer.status, 409, JSON.stringify(answer.body));
    assert.equal(answer.body.code, "conflict");
    assert.match(answer.body.error, /changed on the branch/);
  }
});

test("a read that fails halfway is logged", { skip }, async () => {
  const { s, upload, commit, read } = await setup();
  const parts = [(await upload(noise(6 * MiB, 5))).body.part];
  assert.equal((await commit({ path: "big.bin", parts })).status, 201);

  let reads = 0;
  const stores = s.services.stores;
  const open = stores.engine.bind(stores);
  stores.engine = (region, folder) => {
    const engine = open(region, folder);
    return new Proxy(engine, {
      get(target, name) {
        if (name === "read") {
          return async (...args: Parameters<typeof engine.read>) => {
            if (++reads > 1) throw new Error("the store went away");
            return target.read(...args);
          };
        }
        const value = Reflect.get(target, name);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  await assert.rejects(read("big.bin"));
  const logged = s.logs.find((entry) => entry.msg === "read failed");
  assert.ok(logged, JSON.stringify(s.logs));
  assert.equal(logged.error, "the store went away");
});
