import assert from "node:assert/strict";
import { test } from "node:test";

import { eq } from "drizzle-orm";

import { newKey } from "../src/auth/keys.ts";
import { logins } from "../src/db/schema.ts";
import { server, skip, token } from "./helpers.ts";

async function setup(consoleUrl?: string) {
  const s = await server({ consoleUrl });
  const { id: org, key: admin } = await s.org();
  const start = async (key = newKey(), device = "laptop") => {
    const response = await s.app.request("/v2/logins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key_id: key.id, key_hash: key.hash.toString("hex"), device }),
    });
    return { status: response.status, body: (await response.json()) as any, key };
  };
  return { s, org, admin, start };
}

test("a sign-in the CLI starts gives its key once a person approves it", { skip }, async () => {
  const { s, org, start } = await setup("https://console.example.com/app");
  const started = await start();
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.match(started.body.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(started.body.url, `https://console.example.com/app/cli/${started.body.code}`);
  assert.equal((await s.call("GET", "/whoami", started.key.key)).status, 401);

  const person = await token(org, "admin");
  const path = `/logins/${started.body.code.toLowerCase()}`;
  const shown = await s.call("GET", path, person);
  assert.equal(shown.status, 200, JSON.stringify(shown.body));
  assert.deepEqual(
    { device: shown.body.device, role: shown.body.role, every: shown.body.every_environment },
    { device: "laptop", role: "admin", every: true },
  );

  const approved = await s.call("POST", path, person, { environment: "prod", role: "write" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.name, "cli on laptop");

  const me = await s.call("GET", "/whoami", started.key.key);
  assert.equal(me.status, 200);
  assert.deepEqual(
    { org: me.body.organization, environment: me.body.environment, role: me.body.role },
    { org, environment: "prod", role: "write" },
  );
  assert.equal(
    (await s.call("POST", path, person, { environment: "prod", role: "write" })).status,
    404,
  );
});

test("without the console's address the code comes without a link", { skip }, async () => {
  const { start } = await setup();
  const started = await start();
  assert.equal(started.status, 201);
  assert.equal(started.body.url, null);
});

test("an unknown or expired code is not found", { skip }, async () => {
  const { s, org, start } = await setup();
  const person = await token(org, "admin");
  const approval = { environment: null, role: "read" };
  assert.equal((await s.call("GET", "/logins/ABCD-2345", person)).status, 404);
  assert.equal((await s.call("POST", "/logins/ABCD-2345", person, approval)).status, 404);
  assert.equal((await s.call("GET", "/logins/not-a-code", person)).status, 400);

  const started = await start();
  await s.db
    .update(logins)
    .set({ expires: new Date(Date.now() - 1000) })
    .where(eq(logins.code, started.body.code));
  assert.equal((await s.call("GET", `/logins/${started.body.code}`, person)).status, 404);
  assert.equal(
    (await s.call("POST", `/logins/${started.body.code}`, person, approval)).status,
    404,
  );
  assert.equal((await s.call("GET", "/whoami", started.key.key)).status, 401);
});

test("a key can't approve a sign-in", { skip }, async () => {
  const { s, admin, start } = await setup();
  const started = await start();
  const approval = { environment: "prod", role: "read" };
  const tried = await s.call("POST", `/logins/${started.body.code}`, admin, approval);
  assert.equal(tried.status, 403);
  assert.equal((await s.call("GET", "/whoami", started.key.key)).status, 401);
});

test("only an organization admin gives a key for every environment", { skip }, async () => {
  const { s, org, start } = await setup();
  const member = await token(org, "member");
  const started = await start();
  const path = `/logins/${started.body.code}`;
  assert.equal((await s.call("GET", path, member)).body.every_environment, false);
  const every = await s.call("POST", path, member, { environment: null, role: "write" });
  assert.equal(every.status, 403);
  const more = await s.call("POST", path, member, { environment: "prod", role: "admin" });
  assert.equal(more.status, 403);
  const own = await s.call("POST", path, member, { environment: "prod", role: "write" });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal((await s.call("GET", "/whoami", started.key.key)).body.environment, "prod");
});

test("a sign-in can't take the id of a key or of another sign-in", { skip }, async () => {
  const { s, admin, start } = await setup();
  const made = await s.call("POST", "/keys", admin, { name: "k", role: "read" });
  const taken = newKey();
  const clash = await start({ ...taken, id: made.body.id });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error.code, "conflict");

  assert.equal((await start(taken)).status, 201);
  assert.equal((await start(taken)).status, 409);
  const bad = await start({ ...newKey(), id: "nope" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.path, "key_id");
});
