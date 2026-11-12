import assert from "node:assert/strict";
import { test } from "node:test";

import { ADMIN, NS, call, get, key, names, org, post, ready, unique, write } from "./api.ts";

test("only the admin creates organizations, and names are unique", async () => {
  const name = `o-${unique()}`;
  assert.equal((await post("/orgs", "wrong", { name })).status, 401);
  const created = await post("/orgs", ADMIN, { name });
  assert.equal(created.status, 201);
  assert.match(created.body.key, /^sw_[0-9a-f]{16}_[0-9a-f]{72}$/);
  assert.equal((await post("/orgs", ADMIN, { name })).status, 409);
});

test("organizations see only their own namespaces and branches", async () => {
  const a = await ready();
  const b = await org();

  const fork = { name: "agents/fix-1", from: "main" };
  assert.equal((await post(`${NS}/branches`, a, fork)).status, 201);
  assert.equal((await post(`${NS}/branches`, a, fork)).status, 409);
  assert.deepEqual(names((await get(`${NS}/branches`, a)).body, "name"), ["agents/fix-1", "main"]);
  const agent = (await get(`${NS}/branches/agents%2Ffix-1`, a)).body;
  const main = (await get(`${NS}/branches/main`, a)).body;
  assert.equal(agent.forked_from, "main");
  assert.equal(agent.head, main.head, "a fork starts at its source's head");

  assert.deepEqual((await get("/namespaces", b)).body, []);
  assert.equal((await get(`${NS}/branches/main`, b)).status, 404);
  assert.equal((await get("/namespaces", "sw_nope_nope")).status, 401);

  assert.equal((await call("DELETE", `${NS}/branches/agents%2Ffix-1`, a)).status, 204);
  assert.equal((await get(`${NS}/branches/agents%2Ffix-1`, a)).status, 404);
});

test("keys are limited by role, namespace and expiry", async () => {
  const admin = await ready();
  await post("/namespaces", admin, { name: "staging/app" });

  const reader = await key(admin, "read", "prod/*");
  assert.deepEqual(names((await get("/namespaces", reader)).body, "name"), ["prod/app"]);
  assert.equal((await get(`${NS}/branches`, reader)).status, 200);
  assert.equal((await write(reader, "main", { a: "1" })).status, 403, "a read key cannot write");
  assert.equal((await get("/namespaces/staging%2Fapp/branches", reader)).status, 403);
  assert.equal((await get("/keys", reader)).status, 403, "nor manage keys");

  const scoped = await key(admin, "admin", "prod/*");
  const wider = { name: "wider", role: "admin", namespaces: "*" };
  assert.equal((await post("/keys", scoped, wider)).status, 403, "a key cannot widen itself");

  const scopedKeys = await get("/keys", scoped);
  assert.equal(scopedKeys.status, 403, "only an admin of every namespace lists keys");
  assert.equal(scopedKeys.body.code, "forbidden");
  assert.equal((await get("/audit", scoped)).status, 403, "or reads the audit log");

  const badExpiry = { name: "old", role: "read", expires_in_days: -1 };
  assert.equal((await post("/keys", admin, badExpiry)).status, 400, "expiry is 1 to 3650 days");
  const loose = { name: "loose", role: "read", namespaces: "prod*" };
  assert.equal((await post("/keys", admin, loose)).status, 400, "`*` is a whole part of a name");

  const keys = (await get("/keys", admin)).body;
  assert.equal(keys.length, 3);
  assert.equal(typeof keys[0].last_used, "string", "the first key was used");
  const actions = names((await get("/audit", admin)).body.events, "action");
  assert.ok(actions.includes("createNamespace"));
  assert.ok(actions.includes("createKey"));
});

test("store credentials follow the key's role, when the server can mint them", async () => {
  const admin = await ready();
  const reader = await key(admin, "read", "*");
  const asked = (who: string, access: string) => post(`${NS}/credentials`, who, { access });
  assert.equal((await asked(reader, "write")).status, 403);
  const read = await asked(reader, "read");
  if (read.status === 501) {
    assert.equal(read.body.code, "not_implemented");
    return;
  }
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.match(read.body.store, /^s3:\/\/[^/]+\/.+/);
  assert.equal(read.body.access, "read");
  assert.ok(Date.parse(read.body.expiresAt) > Date.now() + 14 * 60_000);
});
