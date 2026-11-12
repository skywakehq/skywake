import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";

import { connect } from "../src/db/client.ts";
import { ADMIN, DATABASE, server, skip, token } from "./helpers.ts";

test(
  "a public namespace can be read by anyone, and changed only by its own organization",
  { skip },
  async () => {
    const s = await server();
    const owner = await s.ready();
    const other = await s.org();
    const ref = `/namespaces/${owner.id}:prod%2Fapp`;
    const file = `${ref}/branches/main/files/content?path=a.txt`;
    const commit = { message: "x", changes: [{ path: "b", text: "b" }] };

    assert.equal((await s.call("GET", file)).status, 401);
    assert.equal((await s.call("GET", file, other.key)).status, 404);
    assert.equal(
      (await s.call("GET", `/namespaces/${owner.id}:missing/branches`, other.key)).status,
      404,
    );

    const writer = await s.call("POST", "/keys", owner.key, { name: "w", role: "write" });
    const update = (key: string, visibility: string) =>
      s.call("PATCH", "/namespaces/prod%2Fapp", key, { visibility });
    assert.equal((await update(writer.body.key, "public")).status, 403);
    assert.equal((await update(owner.key, "public")).status, 204);
    assert.equal(
      (await s.call("GET", "/namespaces/prod%2Fapp", owner.key)).body.visibility,
      "public",
    );

    assert.equal((await s.call("GET", file)).body, "hello");
    assert.equal((await s.call("GET", file, other.key)).body, "hello");
    const log = await s.call("GET", `${ref}/branches/main/commits`);
    assert.deepEqual(
      log.body.map((commit: any) => commit.message),
      ["add", "empty"],
    );

    assert.equal(
      (await s.call("POST", `${ref}/branches/main/commits`, undefined, commit)).status,
      401,
    );
    assert.equal(
      (await s.call("POST", `${ref}/branches/main/commits`, other.key, commit)).status,
      404,
    );
    assert.equal(
      (await s.call("POST", `${ref}/branches`, other.key, { name: "fork", from: "main" })).status,
      404,
    );
    assert.equal(
      (await s.call("PATCH", `${ref}`, other.key, { visibility: "private" })).status,
      404,
    );
    assert.deepEqual((await s.call("GET", "/namespaces", other.key)).body, []);
    assert.equal(
      (await s.call("POST", `${ref}/branches/main/commits`, owner.key, commit)).status,
      201,
    );

    assert.equal((await update(owner.key, "private")).status, 204);
    assert.equal((await s.call("GET", file)).status, 401);
    assert.equal((await s.call("GET", file, other.key)).status, 404);

    const updates = (await s.call("GET", "/audit?action=updateNamespace", owner.key)).body.events;
    assert.deepEqual(
      updates.map((event: any) => [event.outcome, event.details?.visibility ?? null]),
      [
        ["ok", "private"],
        ["ok", "public"],
        ["denied", null],
      ],
    );
  },
);

test("a namespace can start public", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.org();
  const made = await s.call("POST", "/namespaces", key, { name: "docs", visibility: "public" });
  assert.equal(made.status, 201);
  assert.equal(made.body.visibility, "public");
  assert.equal((await s.call("GET", `/namespaces/${id}:docs`)).body.name, "docs");
});

test("console tokens work like keys", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.org();
  await s.call("POST", "/namespaces", key, { name: "prod/app" });

  const member = await token(id, "member");
  const seen = await s.call("GET", "/namespaces", member);
  assert.equal(seen.status, 200);
  assert.deepEqual(
    seen.body.map((ns: any) => ns.name),
    ["prod/app"],
  );
  assert.equal((await s.call("GET", "/keys", member)).status, 403, "a member is not an admin");
  assert.equal((await s.call("GET", "/keys", await token(id, "owner"))).status, 200);

  assert.equal(
    (await s.call("GET", "/namespaces", await token(id, "owner", "unknown"))).status,
    401,
  );
  assert.equal(
    (await s.call("GET", "/namespaces", await token("org_missing", "owner"))).status,
    401,
  );
  const forged = (await token(id, "owner")).slice(0, -2);
  assert.equal((await s.call("GET", "/namespaces", forged)).status, 401);
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

test("another organization cannot end a session or drop its claims", { skip }, async () => {
  const s = await server();
  const owner = await s.ready();
  const other = await s.ready();
  const sessions = "/namespaces/prod%2Fapp/sessions";
  const started = await s.call("POST", sessions, owner.key, { label: "agent" });
  const id = started.body.id;
  const claim = { path: "src", session: id };
  const claims = "/namespaces/prod%2Fapp/branches/main/claims";
  assert.equal((await s.call("POST", claims, owner.key, claim)).status, 200);

  // The other organization names the session in its own namespace of the same name.
  assert.equal((await s.call("DELETE", `${sessions}/${id}`, other.key)).status, 404);
  const held = await s.call("GET", claims, owner.key);
  assert.deepEqual(
    held.body.map((row: any) => row.path),
    ["src"],
  );
});

test("only an admin merges into a protected branch", { skip }, async () => {
  const s = await server();
  const { key } = await s.ready();
  const ns = "/namespaces/prod%2Fapp";
  const writer = (await s.call("POST", "/keys", key, { name: "w", role: "write" })).body.key;
  assert.equal(
    (await s.call("POST", `${ns}/branches`, writer, { name: "fix", from: "main" })).status,
    201,
  );
  const commit = { message: "fix", changes: [{ path: "b.txt", text: "b" }] };
  assert.equal((await s.call("POST", `${ns}/branches/fix/commits`, writer, commit)).status, 201);
  assert.equal(
    (await s.call("PATCH", `${ns}/branches/main`, key, { protected: true })).status,
    204,
  );

  const merge = { from: "fix", into: "main" };
  const refused = await s.call("POST", `${ns}/merges`, writer, merge);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "forbidden");
  const dryRun = await s.call("POST", `${ns}/merges`, writer, { ...merge, dry_run: true });
  assert.equal(dryRun.status, 200);
  assert.equal((await s.call("POST", `${ns}/merges`, key, merge)).status, 200);
});

test("an expired key is refused", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const made = await s.call("POST", "/keys", key, {
    name: "old",
    role: "read",
    expires_in_days: 1,
  });
  assert.equal((await s.call("GET", "/namespaces", made.body.key)).status, 200);
  await s.db.execute(
    sql`UPDATE api.keys SET expires = now() - interval '1 minute' WHERE id = ${made.body.id}`,
  );
  assert.equal((await s.call("GET", "/namespaces", made.body.key)).status, 401);
});

test("only the organization sees who started a session", { skip }, async () => {
  const s = await server();
  const owner = await s.org();
  const other = await s.org();
  await s.call("POST", "/namespaces", owner.key, { name: "docs", visibility: "public" });
  await s.call("POST", "/namespaces/docs/sessions", owner.key, { label: "agent" });
  const actors = async (key?: string) =>
    (await s.call("GET", `/namespaces/${owner.id}:docs/sessions`, key)).body.map(
      (session: { actor: string | null }) => session.actor,
    );
  assert.match((await actors(owner.key))[0], /^key:/);
  assert.deepEqual(await actors(other.key), [null]);
  assert.deepEqual(await actors(), [null]);
});

/** Makes the engine's `method` wait at a gate, and tells when `count` calls reach it. */
function gate(
  s: Awaited<ReturnType<typeof server>>,
  method: "commitFiles" | "deleteBranch" | "merge",
  count = 1,
) {
  let reached!: () => void;
  let open!: () => void;
  let waiting = 0;
  const arrived = new Promise<void>((resolve) => (reached = resolve));
  const opened = new Promise<void>((resolve) => (open = resolve));
  const stores = s.services.stores;
  const engineOf = stores.engine.bind(stores);
  stores.engine = (region, folder) => {
    const engine = engineOf(region, folder);
    return new Proxy(engine, {
      get(target, name) {
        if (name === method) {
          return async (...args: unknown[]) => {
            if (++waiting === count) reached();
            await opened;
            return (target[method] as (...args: unknown[]) => Promise<unknown>)(...args);
          };
        }
        const value = Reflect.get(target, name);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return { arrived, open, restore: () => (stores.engine = engineOf) };
}

test("protecting a branch waits for writes that were already allowed", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.ready();
  const ns = "/namespaces/prod%2Fapp";
  const writer = (await s.call("POST", "/keys", key, { name: "w", role: "write" })).body.key;
  const commit = { message: "b", changes: [{ path: "b.txt", text: "b" }] };
  const writes = {
    commitFiles: (branch: string) =>
      s.call("POST", `${ns}/branches/${branch}/commits`, writer, commit),
    deleteBranch: (branch: string) => s.call("DELETE", `${ns}/branches/${branch}`, writer),
    merge: (branch: string) =>
      s.call("POST", `${ns}/merges`, writer, { from: "main", into: branch }),
  };
  // Whether protecting is still waiting a while after `protected` is saved.
  const waiting = async (branch: string, protecting: Promise<unknown>) => {
    let settled = false;
    void protecting.finally(() => (settled = true));
    for (;;) {
      const { rows } = await s.db.execute(
        sql`SELECT 1 FROM api.branches WHERE org = ${id} AND name = ${branch} AND protected`,
      );
      if (rows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    return !settled;
  };
  for (const [method, write] of Object.entries(writes)) {
    const branch = `b-${method}`;
    await s.call("POST", `${ns}/branches`, key, { name: branch, from: "main" });
    await s.call("POST", `${ns}/branches/${branch}/commits`, key, {
      message: "other",
      changes: [{ path: "c.txt", text: "c" }],
    });
    const g = gate(s, method as keyof typeof writes);
    const writing = write(branch);
    await g.arrived;
    const protecting = s.call("PATCH", `${ns}/branches/${branch}`, key, { protected: true });
    const waited = await waiting(branch, protecting);
    g.open();
    assert.ok(waited, `${method}: protection did not wait`);
    assert.ok([200, 201, 204].includes((await writing).status), method);
    assert.equal((await protecting).status, 204);
    g.restore();
  }
});

test("slow commits do not hold database connections", { skip }, async () => {
  const { db, pool } = connect(DATABASE!, 2);
  try {
    const s = await server({ databasePool: 2 }, { db });
    const { key } = await s.ready();
    const ns = "/namespaces/prod%2Fapp";
    const count = 6;
    const names = Array.from({ length: count }, (_, i) => `slow-${i}`);
    for (const name of names) await s.call("POST", `${ns}/branches`, key, { name, from: "main" });
    const g = gate(s, "commitFiles", count);
    const commits = names.map((name) =>
      s.call("POST", `${ns}/branches/${name}/commits`, key, {
        message: "x",
        changes: [{ path: "x.txt", text: name }],
      }),
    );
    // More commits than connections must all reach the engine at once.
    const timeout = new Promise((resolve) => setTimeout(() => resolve("stuck"), 5000).unref());
    const all = await Promise.race([g.arrived.then(() => "arrived"), timeout]);
    g.open();
    assert.equal(all, "arrived");
    for (const commit of commits) assert.equal((await commit).status, 201);
    g.restore();
  } finally {
    await pool.end();
  }
});

test("a console token without an expiry is refused", { skip }, async () => {
  const s = await server();
  const { id } = await s.org();
  assert.equal((await s.call("GET", "/namespaces", await token(id, "owner"))).status, 200);
  const forever = await token(id, "owner", "test", null);
  assert.equal((await s.call("GET", "/namespaces", forever)).status, 401);
});

test("sessions starting and ending are in the audit log", { skip }, async () => {
  const s = await server();
  const { key } = await s.ready();
  const started = await s.call("POST", "/namespaces/prod%2Fapp/sessions", key, { label: "a" });
  await s.call("DELETE", `/namespaces/prod%2Fapp/sessions/${started.body.id}`, key);
  const events = (await s.call("GET", "/audit?limit=2", key)).body.events;
  assert.deepEqual(
    events.map((e: any) => [e.action, e.details?.session ?? e.resource.id]),
    [
      ["endSession", started.body.id],
      ["startSession", started.body.id],
    ],
  );
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
  assert.equal((await s.call("GET", "/namespaces", theirs.body.key)).status, 401);
  assert.equal((await s.call("GET", "/namespaces", made.body.key)).status, 401);
  assert.equal((await s.call("GET", "/namespaces", kept.body.key)).status, 200);
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
