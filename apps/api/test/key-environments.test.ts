import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { keys } from "../src/db/schema.ts";
import { newKey } from "../src/auth/keys.ts";
import { database, server, skip, unique } from "./helpers.ts";

const SCHEMA = { vectors: [{ name: "embedding", dims: 2 }], attributes: [] };

async function setup() {
  const s = await server();
  const { key: admin } = await s.org();
  const make = async (body: Record<string, unknown>) => {
    const made = await s.call("POST", "/keys", admin, { name: "k", role: "write", ...body });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return (made.body as { key: string }).key;
  };
  return { s, admin, make };
}

test("whoami names the organization, environment and role", { skip }, async () => {
  const { s, admin, make } = await setup();
  const all = await s.call("GET", "/whoami", admin);
  assert.equal(all.status, 200);
  assert.deepEqual(
    { environment: all.body.environment, role: all.body.role, only: all.body.only },
    { environment: null, role: "admin", only: ["*"] },
  );
  const asked = await s.call("GET", "/whoami", admin, undefined, { "skywake-environment": "prod" });
  assert.equal(asked.body.environment, "prod");

  const staging = await make({ environment: "staging" });
  const me = await s.call("GET", "/whoami", staging);
  assert.equal(me.body.environment, "staging");
  assert.equal(me.body.role, "write");
  assert.equal(me.body.organization, all.body.organization);
  const other = await s.call("GET", "/whoami", staging, undefined, {
    "skywake-environment": "prod",
  });
  assert.equal(other.status, 403);
});

test("a key of one environment can't reach another", { skip }, async () => {
  const { s, make } = await setup();
  const staging = await make({ environment: "staging", role: "admin" });
  const index = (name: string) => s.call("POST", "/indexes", staging, { name, schema: SCHEMA });
  assert.equal((await index("staging/products")).status, 201);
  const denied = await index("prod/products");
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /works in `staging`/);
  assert.equal((await index("products")).status, 403);
  const listed = await s.call("GET", "/environments", staging);
  assert.deepEqual(
    listed.body.map((env: { name: string }) => env.name),
    ["staging"],
  );
});

test("a key reaches only the names it was given", { skip }, async () => {
  const { s, make } = await setup();
  const docs = await make({ environment: "prod", role: "admin", only: ["docs-*", "app"] });
  for (const [name, status] of [
    ["prod/docs-v2", 201],
    ["prod/app", 201],
    ["prod/web", 403],
  ] as const) {
    const made = await s.call("POST", "/indexes", docs, { name, schema: SCHEMA });
    assert.equal(made.status, status, name);
  }
});

test("a key never makes a key that reaches more", { skip }, async () => {
  const { s, make } = await setup();
  const staging = await make({ environment: "staging", role: "admin", only: ["docs-*"] });
  const create = (body: Record<string, unknown>) =>
    s.call("POST", "/keys", staging, { name: "k", role: "read", ...body });
  assert.equal((await create({ environment: "prod" })).status, 403);
  assert.equal((await create({ environment: null })).status, 403);
  assert.equal((await create({ only: ["*"] })).status, 403);
  assert.equal((await create({ only: ["docs-v2"] })).status, 201);
  const inherited = await create({});
  assert.equal(inherited.status, 201);
  const me = await s.call("GET", "/whoami", inherited.body.key);
  assert.deepEqual([me.body.environment, me.body.only], ["staging", ["docs-*"]]);
});

test("the old namespaces pattern still makes keys", { skip }, async () => {
  const { s, admin } = await setup();
  const made = await s.call("POST", "/keys", admin, {
    name: "old",
    role: "read",
    namespaces: "prod/*",
  });
  assert.equal(made.status, 201);
  const listed = await s.call("GET", "/keys", admin);
  const key = listed.body.find((each: { id: string }) => each.id === made.body.id);
  assert.deepEqual([key.environment, key.only, key.namespaces], ["prod", ["*"], "prod/*"]);
});

test("the migration gives old keys their environment", { skip }, async () => {
  const db = await database();
  const { s } = await setup();
  const { body } = await s.call("GET", "/whoami", (await s.org()).key);
  const org = body.organization as string;
  const update = readFileSync(
    new URL("../migrations/0032_key_environments.sql", import.meta.url),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .find((part) => part.includes("UPDATE"))!
    .trim()
    .replace(/;$/, "");
  const cases: [string, string | null, string[]][] = [
    ["*", null, ["*"]],
    ["prod/*", "prod", ["*"]],
    ["prod/app", "prod", ["app"]],
    ["prod/app/worker", "prod", ["app/worker"]],
    ["app", "default", ["app"]],
  ];
  const ids = cases.map(() => newKey().id);
  for (const [i, [pattern]] of cases.entries()) {
    await db.insert(keys).values({
      id: ids[i]!,
      org,
      hash: Buffer.alloc(32),
      name: `old-${unique()}`,
      role: "read",
      namespaces: pattern,
    });
  }
  await db.execute(sql.raw(`${update} WHERE "org" = '${org}' AND "name" LIKE 'old-%'`));
  for (const [i, [pattern, environment, only]] of cases.entries()) {
    const [row] = await db.select().from(keys).where(eq(keys.id, ids[i]!));
    assert.deepEqual([row!.environment, row!.only], [environment, only], pattern);
  }
});
