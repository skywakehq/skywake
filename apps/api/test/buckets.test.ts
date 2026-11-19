import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { Index, Store } from "@skywake/engine";

import { seal, unseal } from "../src/security/sealed.ts";
import { server, skip as noDatabase, unique } from "./helpers.ts";

// An S3 compatible store to stand in for a customer's bucket, such as the dev
// compose's RustFS: SKYWAKE_TEST_S3=http://127.0.0.1:9100 with bucket `byob-test`.
const S3 = process.env.SKYWAKE_TEST_S3;
const BUCKET = process.env.SKYWAKE_TEST_S3_BUCKET ?? "byob-test";
const skip = noDatabase || (S3 ? false : "needs SKYWAKE_TEST_S3");
const keys = { accessKeyId: "skywake", secretAccessKey: "skywake-dev" };

const secretKey = randomBytes(32);

function storeOf() {
  return `s3://${BUCKET}/t-${unique()}`;
}

function access() {
  return { type: "keys", ...keys, endpoint: S3, region: "us-east-1" };
}

test("a sealed value opens only with its key and its context", () => {
  const sealed = seal(secretKey, "secret", "a");
  assert.equal(unseal(secretKey, sealed, "a"), "secret");
  assert.throws(() => unseal(secretKey, sealed, "b"));
  assert.throws(() => unseal(randomBytes(32), sealed, "a"));
  assert.ok(!sealed.includes("secret"));
});

test("an environment keeps indexes in the bucket it brings", { skip }, async () => {
  const s = await server({ secretKey });
  const { id, key } = await s.org();
  assert.equal((await s.call("POST", "/environments", key, { name: "prod" })).status, 201);
  const store = storeOf();

  const set = await s.call("PUT", "/environments/prod/store", key, { store, access: access() });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.store, store);
  assert.equal(set.body.access.type, "keys");
  assert.ok(set.body.verified);
  // The secret is never shown again, nor kept in the clear.
  assert.ok(!JSON.stringify(set.body).includes(keys.secretAccessKey));
  const listed = await s.call("GET", "/environments", key);
  assert.ok(!JSON.stringify(listed.body).includes(keys.secretAccessKey));

  // An index made in the environment lands in the bucket.
  const made = await s.call("POST", "/indexes", key, {
    name: "prod/docs",
    schema: { vectors: [{ name: "v", dims: 2 }], attributes: [] },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));

  await Store.open(store, {
    keys: { id: `t-${unique()}`, ...keys, endpoint: S3, region: "us-east-1" },
  }).check();

  const ix = (await s.services.db.query.indexes.findFirst({
    where: (t, { and, eq }) => and(eq(t.org, id), eq(t.name, "prod/docs")),
  }))!;
  assert.match(ix.folder, /^ix\/ix_/);
  const index = Index.open(`${store}/${ix.folder}`, {
    keys: { id: `t-${unique()}`, ...keys, endpoint: S3, region: "us-east-1" },
  });
  assert.deepEqual(await index.branches(), ["main"]);

  // The bucket can't change once the environment holds data.
  const again = await s.call("PUT", "/environments/prod/store", key, {
    store: storeOf(),
    access: access(),
  });
  assert.equal(again.status, 409);
  assert.equal((await s.call("DELETE", "/environments/prod/store", key)).status, 409);

  // Another environment still uses the server's regions.
  const dev = await s.call("POST", "/indexes", key, {
    name: "dev/docs",
    schema: { vectors: [{ name: "v", dims: 2 }], attributes: [] },
  });
  assert.equal(dev.status, 201);
  assert.equal(dev.body.region, "local");
});

test("a bucket the API can't use is refused before anything is kept", { skip }, async () => {
  const s = await server({ secretKey });
  const { key } = await s.org();
  await s.call("POST", "/environments", key, { name: "prod" });
  const wrong = { ...access(), secretAccessKey: "not-the-key" };
  const set = await s.call("PUT", "/environments/prod/store", key, {
    store: storeOf(),
    access: wrong,
  });
  assert.equal(set.status, 400, JSON.stringify(set.body));
  const listed = await s.call("GET", "/environments", key);
  assert.equal(listed.body.find((env: { name: string }) => env.name === "prod").store, null);
});

test("keys can't be kept without a secret key on the server", { skip: noDatabase }, async () => {
  const s = await server();
  const { key } = await s.org();
  await s.call("POST", "/environments", key, { name: "prod" });
  const set = await s.call("PUT", "/environments/prod/store", key, {
    store: "s3://some-bucket/x",
    access: { type: "keys", accessKeyId: "a", secretAccessKey: "b" },
  });
  assert.equal(set.status, 501);
});

test("a role's trust names the organization's external ID", { skip: noDatabase }, async () => {
  const s = await server({ byobPrincipal: "arn:aws:iam::123456789012:root" });
  const { id, key } = await s.org();
  const trust = await s.call("GET", "/environments/prod/store/trust", key);
  assert.equal(trust.status, 200);
  assert.equal(trust.body.externalId, `skywake-${id}`);
  assert.equal(trust.body.principal, "arn:aws:iam::123456789012:root");
});
