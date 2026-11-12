import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

import { NS, call, get, names, post, ready } from "./api.ts";

test("sessions tag commits and hold claims until they end", async () => {
  const key = await ready();
  const started = await post(`${NS}/sessions`, key, { label: "agent-a" });
  assert.equal(started.status, 201);
  const a = started.body.id;
  const b = (await post(`${NS}/sessions`, key, { label: "agent-b", seconds: 1 })).body.id;

  const claims = `${NS}/branches/main/claims`;
  assert.equal((await post(claims, key, { path: "src/auth", session: a })).status, 200);
  const held = await post(claims, key, { path: "src", session: b });
  assert.equal(held.status, 409, "a folder above a claim is taken");
  assert.equal(held.body.label, "agent-a");
  assert.equal((await post(claims, key, { path: "src/auth/login.rs", session: b })).status, 409);
  assert.equal((await post(claims, key, { path: "src/billing", session: b })).status, 200);

  const commit = { message: "auth", session: a, changes: [{ path: "src/auth/x", text: "x" }] };
  await post(`${NS}/branches/main/commits`, key, commit);
  assert.equal((await get(`${NS}/branches/main/commits?limit=1`, key)).body[0].session, a);

  // When a session stops sending heartbeats, its claims end.
  await sleep(1500);
  assert.deepEqual(names((await get(`${NS}/sessions`, key)).body, "label"), ["agent-a"]);
  assert.equal((await call("PUT", `${NS}/sessions/${b}`, key, {})).status, 404);
  assert.equal((await call("PUT", `${NS}/sessions/${a}`, key, {})).status, 200);
  assert.deepEqual(names((await get(claims, key)).body, "path"), ["src/auth"]);

  assert.equal((await call("DELETE", `${claims}?path=src/auth&session=${a}`, key)).status, 204);
  assert.equal((await call("DELETE", `${NS}/sessions/${a}`, key)).status, 204);
  const late = { message: "late", session: a, changes: [] };
  assert.equal(
    (await post(`${NS}/branches/main/commits`, key, late)).status,
    400,
    "an ended session cannot commit",
  );
});
