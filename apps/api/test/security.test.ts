import assert from "node:assert/strict";
import { test } from "node:test";

import { eq } from "drizzle-orm";

import { keyId, newKey } from "../src/auth/keys.ts";
import { matches } from "../src/auth/roles.ts";
import { loadConfig } from "../src/config.ts";
import { rateLimits } from "../src/db/schema.ts";
import { addressGroup } from "../src/http/rate-limit.ts";
import { ADMIN, database, server, skip, unique } from "./helpers.ts";

test("every response carries safe headers, and errors say little", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const listed = await s.call("GET", "/namespaces", key);
  assert.equal(listed.headers.get("x-content-type-options"), "nosniff");
  assert.equal(listed.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.ok(listed.headers.get("x-request-id"));

  const missing = await s.call("GET", "/nothing-here", key);
  assert.deepEqual(missing.body, {
    error: "no such route",
    code: "not_found",
    request_id: missing.headers.get("x-request-id"),
  });
  const bad = await s.call("POST", "/namespaces", key, { name: "../etc" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "invalid");
  assert.match(bad.body.error, /^name: use parts of letters/);
  assert.equal(
    (await s.call("POST", "/namespaces", key, { name: "a", visibility: "secret" })).status,
    400,
  );
  assert.equal((await s.call("GET", "/namespaces", "sw_nope_nope")).status, 401);
  assert.equal((await s.call("GET", "/namespaces", "not.a.jwt")).status, 401);
});

test("only the admin token creates organizations", { skip }, async () => {
  const s = await server();
  assert.equal((await s.call("POST", "/orgs", "wrong", { name: `o-${unique()}` })).status, 401);
  assert.equal((await s.call("POST", "/orgs", undefined, { name: `o-${unique()}` })).status, 401);
  const closed = await server({ adminToken: undefined });
  assert.equal((await closed.call("POST", "/orgs", ADMIN, { name: `o-${unique()}` })).status, 401);
});

test("too many requests are turned away, counted across every API process", { skip }, async () => {
  await (await database()).delete(rateLimits);
  const one = await server({ rateLimit: 3 });
  const two = await server({ rateLimit: 3 });
  const sync = async () => {
    for (const s of [one, two]) await s.services.limiter!.sync();
  };
  const statuses = [];
  for (const s of [one, two, one, two]) {
    statuses.push((await s.call("GET", "/regions")).status);
    await sync();
  }
  assert.deepEqual(statuses, [401, 401, 401, 429]);
  const limited = await one.call("GET", "/regions");
  assert.equal(limited.body.code, "rate_limited");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});

test("tens of thousands of clients in one second still reach Postgres", { skip }, async () => {
  await (await database()).delete(rateLimits);
  const s = await server({ rateLimit: 100 });
  const limiter = s.services.limiter!;
  const clients = 30_000;
  const c = { get: () => undefined, set: () => {}, header: () => {} } as never;
  for (let i = 0; i < clients; i++) await limiter.hit(c, `load-${i}`);
  await limiter.sync();
  const stored = await (await database()).select().from(rateLimits);
  assert.equal(stored.filter((row) => row.client.startsWith("load-")).length, clients);
});

test("a forged X-Forwarded-For does not get around the limit", { skip }, async () => {
  const s = await server({ rateLimit: 3, trustProxy: 1 });
  const client = `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    const forwarded = { "x-forwarded-for": `198.51.100.${i}, ${client}` };
    statuses.push((await s.call("GET", "/regions", undefined, undefined, forwarded)).status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 429]);
});

test("IPv6 clients are counted by their /64", { skip }, async () => {
  assert.equal(addressGroup("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(addressGroup("2001:db8:1:2::ffff"), "2001:db8:1:2::/64");
  assert.equal(addressGroup("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(addressGroup("::ffff:192.0.2.7"), "192.0.2.7");
  assert.equal(addressGroup("192.0.2.7"), "192.0.2.7");

  const s = await server({ rateLimit: 3, trustProxy: 1 });
  const net = Array.from({ length: 4 }, () => Math.floor(Math.random() * 0xffff).toString(16));
  const statuses = [];
  for (let i = 1; i <= 4; i++) {
    const forwarded = { "x-forwarded-for": `${net.join(":")}::${i}` };
    statuses.push((await s.call("GET", "/regions", undefined, undefined, forwarded)).status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 429]);
});

test("each key has its own limit, wherever it calls from", { skip }, async () => {
  await (await database()).delete(rateLimits);
  const s = await server({ rateLimit: 4, trustProxy: 1 });
  const { key } = await s.org();
  const from = () => ({
    "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250)}-${unique()}`,
  });
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await s.call("GET", "/namespaces", key, undefined, from())).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 429]);
});

test("old request counts are cleared", { skip }, async () => {
  const db = await database();
  const old = `ip:old-${unique()}`;
  await db.insert(rateLimits).values({ client: old, window: 1, count: 5 });
  const s = await server({ rateLimit: 100 });
  await s.call("GET", "/regions");
  await s.services.limiter!.sync();
  assert.deepEqual(await db.select().from(rateLimits).where(eq(rateLimits.client, old)), []);
});

test("health checks are never rate limited", { skip }, async () => {
  await (await database()).delete(rateLimits);
  const s = await server({ rateLimit: 1 });
  for (let i = 0; i < 3; i++) {
    assert.equal((await s.app.request("/health")).status, 200);
    assert.equal((await s.app.request("/ready")).status, 200);
  }
});

test("large bodies are turned away", { skip }, async () => {
  const s = await server({ bodyLimit: 1024 });
  const { key } = await s.org();
  const big = { message: "big", changes: [{ path: "a", text: "x".repeat(4096) }] };
  assert.equal(
    (await s.call("POST", "/namespaces/prod%2Fapp/branches/main/commits", key, big)).status,
    413,
  );
});

test("settings are checked at start", () => {
  const base = { SKYWAKE_API_DATABASE: "postgres://x", SKYWAKE_STORE: "/tmp/x" };
  assert.throws(() => loadConfig({ ...base, SKYWAKE_API_ADMIN_TOKEN: "short" }), /at least 16/);
  assert.throws(() => loadConfig({ SKYWAKE_STORE: "/tmp/x" }), /SKYWAKE_API_DATABASE/);
  const config = loadConfig({ ...base, SKYWAKE_API_REGIONS: "eu=s3://eu?region=eu-central-1" });
  assert.deepEqual(config.regions, [
    ["local", "/tmp/x"],
    ["eu", "s3://eu?region=eu-central-1"],
  ]);
  assert.equal(config.rateLimit, 1200);
  assert.equal(config.trustProxy, 0);
  assert.equal(loadConfig({ ...base, SKYWAKE_API_TRUST_PROXY: "true" }).trustProxy, 1);
  assert.equal(loadConfig({ ...base, SKYWAKE_API_TRUST_PROXY: "2" }).trustProxy, 2);
  assert.throws(() => loadConfig({ ...base, SKYWAKE_API_TRUST_PROXY: "yes" }));
  const empty = loadConfig({ ...base, SKYWAKE_API_STS_ROLE_ARN: "", AWS_ENDPOINT: "" });
  assert.equal(empty.sts, undefined);
  assert.equal(empty.s3.endpoint, null);
});

test("console tokens need an issuer and an audience", () => {
  const base = { SKYWAKE_API_DATABASE: "postgres://x", SKYWAKE_STORE: "/tmp/x" };
  const jwks = { ...base, SKYWAKE_API_JWKS_URL: "https://console.example/jwks" };
  assert.throws(() => loadConfig(jwks), /ISSUER/);
  assert.throws(() => loadConfig({ ...jwks, SKYWAKE_API_JWT_ISSUER: "console" }), /AUDIENCE/);
  const config = loadConfig({
    ...jwks,
    SKYWAKE_API_JWT_ISSUER: "console",
    SKYWAKE_API_JWT_AUDIENCE: "api",
  });
  assert.deepEqual(config.jwks, {
    url: "https://console.example/jwks",
    issuer: "console",
    audience: "api",
  });
});

test("keys carry a prefix and a checksum that scanners can check", () => {
  const { id, key } = newKey();
  assert.match(key, /^sw_[0-9a-f]{16}_[0-9a-f]{72}$/);
  assert.equal(keyId(key), id);
  const flipped = key.slice(0, 30) + (key[30] === "a" ? "b" : "a") + key.slice(31);
  assert.equal(keyId(flipped), null);
  assert.equal(keyId(`bfs_${id}_${"0".repeat(64)}`), null);
});

test("key expiry is a whole number of days", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  for (const days of [0, 0.5, -1, 3651]) {
    const made = await s.call("POST", "/keys", key, {
      name: "k",
      role: "read",
      expires_in_days: days,
    });
    assert.equal(made.status, 400, `${days} days`);
  }
  const made = await s.call("POST", "/keys", key, { name: "k", role: "read", expires_in_days: 30 });
  assert.equal(made.status, 201);
});

test("key scopes match a name or a prefix", () => {
  assert.ok(matches("*", "prod/app"));
  assert.ok(matches("prod/*", "prod/app"));
  assert.ok(!matches("prod/*", "staging/app"));
  assert.ok(matches("prod/app", "prod/app"));
  assert.ok(!matches("prod/app", "prod/app2"));
  assert.ok(matches("prod/*", "prod/app/worker"));
  assert.ok(!matches("prod*", "production/app"));
  assert.ok(!matches("prod*", "prod/app"));
});

test("key scopes are whole parts of names", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const make = (namespaces: string) =>
    s.call("POST", "/keys", key, { name: "k", role: "read", namespaces });
  assert.equal((await make("prod*")).status, 400);
  assert.equal((await make("pr*d/app")).status, 400);
  assert.equal((await make("prod/*")).status, 201);
  assert.equal((await make("prod/app")).status, 201);
  assert.equal((await make("*")).status, 201);
});

test("a key never outlives the key that made it", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  const admin = await s.call("POST", "/keys", key, {
    name: "ci",
    role: "admin",
    expires_in_days: 2,
  });
  const expiry = async (id: string) =>
    (await s.call("GET", "/keys", key)).body.find((row: { id: string }) => row.id === id).expires;
  const limit = await expiry(admin.body.id);
  for (const expires_in_days of [undefined, 30]) {
    const made = await s.call("POST", "/keys", admin.body.key, {
      name: "made",
      role: "read",
      expires_in_days,
    });
    assert.equal(made.status, 201);
    assert.equal(await expiry(made.body.id), limit);
  }
  const sooner = await s.call("POST", "/keys", admin.body.key, {
    name: "sooner",
    role: "read",
    expires_in_days: 1,
  });
  assert.ok((await expiry(sooner.body.id)) < limit);
});
