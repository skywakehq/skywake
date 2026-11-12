import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";

import { sql } from "drizzle-orm";

import { keyId } from "../src/auth/keys.ts";
import { Remembered } from "../src/auth/remembered.ts";
import { database, listen, peerPair, type Server, shut, skip } from "./helpers.ts";

const TOKEN = "peer-token-for-lease-tests-0123";
const SCHEMA = { vectors: [{ name: "v", dims: 2 }] };
const MAIN = "/indexes/shared/branches/main";

async function pair(t: TestContext) {
  const [a, b] = await peerPair(TOKEN);
  const http = await Promise.all(
    [a, b].map(async (s) => {
      const listening = await listen(s);
      await s.services.pinning.tick();
      await s.services.changes.start();
      return listening;
    }),
  );
  t.after(async () => {
    for (const s of [a, b]) {
      await s.services.changes.stop();
      await s.services.leases.stop();
      await s.services.pinning.stop();
    }
    for (const listening of http) shut(listening);
  });
  const { key } = await a.org();
  return { a, b, key, http };
}

const hits = async (s: Server, key: string) => {
  const found = await s.call("POST", `${MAIN}/query`, key, {
    vector: { column: "v", value: [0, 0] },
    topK: 10,
  });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  return found.body.hits.length as number;
};

const upsert = async (s: Server, key: string, id: number) => {
  const wrote = await s.call("POST", `${MAIN}/documents`, key, {
    documents: [{ id, vectors: { v: [id, 0] } }],
  });
  assert.equal(wrote.status, 200, JSON.stringify(wrote.body));
};

const callerOf = async (s: Server, key: string) => (await s.services.auth.caller(key))!;

const folderOf = async (s: Server, key: string) =>
  (await s.services.access.index(await callerOf(s, key), "shared", "admin")).folder;

test(
  "a lease holder sees a write just made on another server, with no head read",
  { skip },
  async (t) => {
    const { a, b, key } = await pair(t);
    assert.equal(
      (await a.call("POST", "/indexes", key, { name: "shared", schema: SCHEMA })).status,
      201,
    );
    const folder = await folderOf(a, key);

    assert.equal(await hits(b, key), 0);
    await b.services.leases.tick();
    assert.notEqual(b.services.leases.epoch(folder, "main"), undefined);

    for (let id = 1; id <= 3; id++) {
      await upsert(a, key, id);
      assert.equal(await hits(b, key), id);
      assert.equal(await hits(b, key), id);
    }
  },
);

test(
  "a holder that can't be told loses its lease before the write answers",
  { skip },
  async (t) => {
    const { a, b, key, http } = await pair(t);
    assert.equal(
      (await a.call("POST", "/indexes", key, { name: "shared", schema: SCHEMA })).status,
      201,
    );
    const folder = await folderOf(a, key);
    assert.equal(await hits(b, key), 0);
    await b.services.leases.tick();
    const before = b.services.leases.epoch(folder, "main");
    assert.notEqual(before, undefined);

    http[1]!.closeAllConnections();
    await new Promise<void>((resolve) => http[1]!.close(() => resolve()));
    const started = performance.now();
    await upsert(a, key, 1);
    // The write waited out the lease it could not reach.
    assert.ok(performance.now() - started > 5000);
    assert.equal(b.services.leases.epoch(folder, "main"), undefined);
    assert.equal(await hits(b, key), 1);
    // A lease taken again starts at a new epoch, so it reads the head again.
    await b.services.leases.tick();
    const after = b.services.leases.epoch(folder, "main");
    assert.notEqual(after, undefined);
    assert.notEqual(after, before);
  },
);

test("a key deleted on one server stops working on another", { skip }, async (t) => {
  const { a, b, key } = await pair(t);
  assert.equal((await b.call("GET", "/indexes", key)).status, 200);
  const deleted = await a.call("DELETE", `/keys/${keyId(key)}`, key);
  assert.ok(deleted.status < 300, JSON.stringify(deleted.body));
  let status = 200;
  for (let i = 0; i < 50 && status === 200; i++) {
    status = (await b.call("GET", "/indexes", key)).status;
    if (status === 200) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(status, 401);
});

test("a key removed without a notice still can't write", { skip }, async (t) => {
  const { a, b, key } = await pair(t);
  assert.equal((await b.call("GET", "/indexes", key)).status, 200);
  const db = await database();
  // Triggers don't run for a replica session, so no notice is sent.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(sql`DELETE FROM api.keys WHERE id = ${keyId(key)}`);
  });
  assert.equal((await b.call("GET", "/indexes", key)).status, 200);
  const wrote = await b.call("POST", "/indexes", key, { name: "late", schema: SCHEMA });
  assert.equal(wrote.status, 401);
});

test("a lookup that started before a change is not kept", async () => {
  const kept = new Remembered<number>(60_000);
  let finish: (value: number) => void = () => {};
  const slow = kept.get("k", () => new Promise<number>((resolve) => (finish = resolve)));
  kept.drop("k");
  finish(1);
  assert.equal(await slow, 1);
  assert.equal(await kept.get("k", async () => 2), 2);
  assert.equal(await kept.get("k", async () => 3), 2);
});
