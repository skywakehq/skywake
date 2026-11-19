import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { document } from "@skywake/contract";

import { server, skip } from "./helpers.ts";

test("an environment has no region; each index picks its own", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  assert.deepEqual((await s.call("GET", "/regions", key)).body, [
    { name: "local", default: true },
    { name: "eu", default: false },
  ]);
  const env = await s.call("POST", "/environments", key, { name: "prod" });
  assert.equal(env.status, 201);
  assert.equal(env.body.region, undefined);
  assert.equal((await s.call("POST", "/environments", key, { name: "prod" })).status, 409);

  const schema = { vectors: [{ name: "v", dims: 2 }] };
  const index = await s.call("POST", "/indexes", key, { name: "prod/docs", region: "eu", schema });
  assert.equal(index.body.region, "eu");
  const local = await s.call("POST", "/indexes", key, { name: "prod/web", schema });
  assert.equal(local.body.region, "local", "the default region when none is asked for");
  assert.equal(
    (await s.call("POST", "/indexes", key, { name: "prod/x", region: "mars", schema })).status,
    400,
  );
  const copy = await s.call("POST", "/indexes/prod%2Fdocs/copy", key, { name: "prod/docs-copy" });
  assert.equal(copy.body.region, "eu", "a copy stays in its source's region");
  assert.ok(existsSync(join(s.store, "eu")));
});

test("the server describes itself with the contract's document", { skip }, async () => {
  const s = await server();
  const served = await s.call("GET", "/openapi.json");
  assert.equal(served.status, 200);
  assert.deepEqual(served.body, JSON.parse(JSON.stringify(document())));
});
