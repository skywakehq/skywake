import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";

import { connect } from "../src/db/client.ts";
import { ADMIN, DATABASE, server, skip, token } from "./helpers.ts";

test("console tokens work like keys", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.org();
  const schema = { vectors: [{ name: "v", dims: 2 }], attributes: [] };
  await s.call("POST", "/indexes", key, { name: "prod/app", schema });

  const member = await token(id, "member");
  const seen = await s.call("GET", "/indexes", member);
  assert.equal(seen.status, 200);
  assert.deepEqual(
    seen.body.map((index: any) => index.name),
    ["prod/app"],
  );
  assert.equal((await s.call("GET", "/keys", member)).status, 403, "a member is not an admin");
  assert.equal((await s.call("GET", "/keys", await token(id, "owner"))).status, 200);

  assert.equal((await s.call("GET", "/indexes", await token(id, "owner", "unknown"))).status, 401);
  assert.equal((await s.call("GET", "/indexes", await token("org_missing", "owner"))).status, 401);
  const forged = (await token(id, "owner")).slice(0, -2);
  assert.equal((await s.call("GET", "/indexes", forged)).status, 401);
});

test("only an admin key for every namespace sees keys and the audit log", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const scoped = await s.call("POST", "/keys", key, {
    name: "prod admin",
    role: "admin",
    namespaces: "prod/*",
  });
  assert.equal(scoped.status, 201);
  assert.equal((await s.call("GET", "/keys", scoped.body.key)).status, 403);
  assert.equal((await s.call("DELETE", `/keys/${scoped.body.id}`, scoped.body.key)).status, 403);
  assert.equal((await s.call("GET", "/audit", scoped.body.key)).status, 403);
  assert.equal((await s.call("GET", "/keys", key)).status, 200);
  assert.equal((await s.call("GET", "/audit", key)).status, 200);
});

test("an expired key is refused", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const made = await s.call("POST", "/keys", key, {
    name: "old",
    role: "read",
    expires_in_days: 1,
  });
  assert.equal((await s.call("GET", "/indexes", made.body.key)).status, 200);
  await s.db.execute(
    sql`UPDATE api.keys SET expires = now() - interval '1 minute' WHERE id = ${made.body.id}`,
  );
  assert.equal((await s.call("GET", "/indexes", made.body.key)).status, 401);
});

/** Makes every index's `upsert` wait at a gate, and tells when `count` calls reach it. */
function gate(s: Awaited<ReturnType<typeof server>>, count: number) {
  let reached!: () => void;
  let open!: () => void;
  let waiting = 0;
  const arrived = new Promise<void>((resolve) => (reached = resolve));
  const opened = new Promise<void>((resolve) => (open = resolve));
  const stores = s.services.stores;
  const indexOf = stores.index.bind(stores);
  stores.index = (region, folder, options) => {
    const index = indexOf(region, folder, options);
    return new Proxy(index, {
      get(target, name) {
        if (name === "upsert") {
          return async (...args: Parameters<typeof target.upsert>) => {
            if (++waiting === count) reached();
            await opened;
            return target.upsert(...args);
          };
        }
        const value = Reflect.get(target, name);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return { arrived, open, restore: () => (stores.index = indexOf) };
}

test("slow writes do not hold database connections", { skip }, async () => {
  const { db, pool } = connect(DATABASE!, 2);
  try {
    const s = await server({ databasePool: 2 }, { db });
    const { key } = await s.org();
    const count = 6;
    const names = Array.from({ length: count }, (_, i) => `slow-${i}`);
    const schema = { vectors: [{ name: "v", dims: 2 }], attributes: [] };
    for (const name of names) await s.call("POST", "/indexes", key, { name, schema });
    const g = gate(s, count);
    const writes = names.map((name) =>
      s.call("POST", `/indexes/${name}/branches/main/documents`, key, {
        documents: [{ id: 1, vectors: { v: [1, 0] } }],
      }),
    );
    // More writes than connections must all reach the engine at once.
    const timeout = new Promise((resolve) => setTimeout(() => resolve("stuck"), 5000).unref());
    const all = await Promise.race([g.arrived.then(() => "arrived"), timeout]);
    g.open();
    assert.equal(all, "arrived");
    for (const write of writes) assert.equal((await write).status, 200);
    g.restore();
  } finally {
    await pool.end();
  }
});

test("a console token without an expiry is refused", { skip }, async () => {
  const s = await server();
  const { id } = await s.org();
  assert.equal((await s.call("GET", "/indexes", await token(id, "owner"))).status, 200);
  const forever = await token(id, "owner", "test", null);
  assert.equal((await s.call("GET", "/indexes", forever)).status, 401);
});

test("a person's keys, and the keys those made, go when the person leaves", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.org();
  const person = await token(id, "owner", "test", "1m", { email: "ada@example.com" });
  const theirs = await s.call("POST", "/keys", person, { name: "laptop", role: "admin" });
  assert.equal(theirs.status, 201, JSON.stringify(theirs.body));
  const made = await s.call("POST", "/keys", theirs.body.key, { name: "agent", role: "write" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const kept = await s.call("POST", "/keys", key, { name: "ci", role: "read" });

  const listed = (await s.call("GET", "/keys", person)).body;
  const byId = Object.fromEntries(listed.map((k: any) => [k.id, k]));
  assert.equal(byId[theirs.body.id].created_by, "user:user-1");
  assert.equal(byId[theirs.body.id].created_by_email, "ada@example.com");
  assert.equal(byId[made.body.id].created_by, `key:${theirs.body.id}`);

  const path = `/orgs/${id}/members/user-1/keys`;
  assert.equal((await s.call("DELETE", path, key)).status, 401);
  const revoked = await s.call("DELETE", path, ADMIN);
  assert.deepEqual([revoked.status, revoked.body], [200, { revoked: 2 }]);
  assert.equal((await s.call("GET", "/indexes", theirs.body.key)).status, 401);
  assert.equal((await s.call("GET", "/indexes", made.body.key)).status, 401);
  assert.equal((await s.call("GET", "/indexes", kept.body.key)).status, 200);
});

test("a stranger with a bad body gets 401, not the body's errors", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const bad = { topK: "many" };
  const stranger = await s.call("POST", "/indexes/x/branches/main/query", undefined, bad);
  assert.equal(stranger.status, 401);
  const wrongKey = await s.call("POST", "/indexes/x/branches/main/query", "sk_nope", bad);
  assert.equal(wrongKey.status, 401);
  const member = await s.call("POST", "/indexes/x/branches/main/query", key, bad);
  assert.equal(member.status, 400);
  const operator = await s.call("POST", "/orgs", ADMIN, { name: "" });
  assert.equal(operator.status, 400);
});
