import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

import { loadConfig } from "../src/config.ts";
import * as branches from "../src/features/branches/queries.ts";
import { Credentials, placeOf, policyFor } from "../src/features/credentials/mint.ts";
import { passFor } from "../src/features/credentials/pass.ts";
import { server, skip, unique } from "./helpers.ts";

const NS = "/namespaces/prod%2Fapp";

test("a namespace's place in the bucket comes from its location", () => {
  assert.deepEqual(placeOf("s3://bucket/org_1/ns_2", "us-east-1"), {
    bucket: "bucket",
    prefix: "org_1/ns_2",
    region: "us-east-1",
  });
  assert.deepEqual(placeOf("s3://bucket/base/org_1/ns_2/?region=eu-west-1", "us-east-1"), {
    bucket: "bucket",
    prefix: "base/org_1/ns_2",
    region: "eu-west-1",
  });
  assert.equal(placeOf("/var/skywake/org_1/ns_2", "us-east-1"), null);
});

test("the session policy reaches only the namespace's prefix", () => {
  const place = { bucket: "b", prefix: "org_1/ns_2", region: "us-east-1" };
  const list = {
    Effect: "Allow",
    Action: ["s3:ListBucket"],
    Resource: ["arn:aws:s3:::b"],
    Condition: { StringLike: { "s3:prefix": ["org_1/ns_2/*"] } },
  };
  const gc = {
    Effect: "Deny",
    Action: ["s3:PutObject"],
    Resource: ["arn:aws:s3:::b/org_1/ns_2/gc/*"],
  };
  const kind = {
    Effect: "Deny",
    Action: ["s3:PutObject"],
    Resource: ["arn:aws:s3:::b/org_1/ns_2/skywake.json"],
  };
  assert.deepEqual(policyFor(place, "read"), {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::b/org_1/ns_2/*"] },
      list,
      gc,
      kind,
    ],
  });
  assert.deepEqual(policyFor(place, "write").Statement, [
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"],
      Resource: ["arn:aws:s3:::b/org_1/ns_2/*"],
    },
    list,
    gc,
    kind,
  ]);
  assert.deepEqual(policyFor(place, "write", ["main", "release/v1"]).Statement[4], {
    Effect: "Deny",
    Action: ["s3:PutObject"],
    Resource: ["arn:aws:s3:::b/org_1/ns_2/refs/main", "arn:aws:s3:::b/org_1/ns_2/refs/release/v1"],
  });
  assert.equal(policyFor(place, "read", ["main"]).Statement.length, 4);
  assert.deepEqual(policyFor(place, "write", ["main"], true).Statement[4], {
    Effect: "Deny",
    Action: ["s3:PutObject"],
    Resource: ["arn:aws:s3:::b/org_1/ns_2/refs/*"],
  });
});

test("a pass names its folder, access, protected branches and expiry, signed with the cache token", () => {
  const pass = passFor("token", "org_1/ns_2", "write", ["main"], "2100-01-01T00:00:00Z");
  const [body = "", tag = ""] = pass.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(body, "base64url").toString()), {
    folder: "org_1/ns_2",
    access: "write",
    protected: ["main"],
    expires: 4102444800,
  });
  const expected = createHmac("sha256", "token")
    .update(Buffer.from(body, "base64url"))
    .digest("base64url");
  assert.equal(tag, expected);
});

test("the session name in the bucket's logs never shows a person's email", async (t) => {
  const names: string[] = [];
  t.mock.method(STSClient.prototype, "send", async (command: AssumeRoleCommand) => {
    names.push(command.input.RoleSessionName!);
    return {
      Credentials: {
        AccessKeyId: "a",
        SecretAccessKey: "s",
        SessionToken: "t",
        Expiration: new Date(),
      },
    };
  });
  const sts = { roleArn: "arn:aws:iam::1:role/r", endpoint: undefined, seconds: 900 };
  const credentials = new Credentials(sts, "us-east-1", { accessKeyId: "a", secretAccessKey: "s" });
  const place = { bucket: "b", prefix: "p", region: "us-east-1" };
  await credentials.mint(place, "read", "user:ann@example.com");
  await credentials.mint(place, "read", "key:k123");
  assert.match(names[0]!, /^skywake-user-[0-9a-f]{24}$/);
  assert.equal(names[1], "skywake-key-k123");
});

test("the same caller asking again reuses its credentials while most of their life is left", async (t) => {
  let calls = 0;
  let expires = Date.now() + 900_000;
  t.mock.method(STSClient.prototype, "send", async () => {
    calls++;
    return {
      Credentials: {
        AccessKeyId: `a${calls}`,
        SecretAccessKey: "s",
        SessionToken: "t",
        Expiration: new Date(expires),
      },
    };
  });
  const sts = { roleArn: "arn:aws:iam::1:role/r", endpoint: undefined, seconds: 900 };
  const credentials = new Credentials(sts, "us-east-1", { accessKeyId: "a", secretAccessKey: "s" });
  const place = { bucket: "b", prefix: "p", region: "us-east-1" };
  const first = await Promise.all([1, 2, 3].map(() => credentials.mint(place, "read", "key:k1")));
  assert.equal(calls, 1, "asked at once, minted once");
  assert.ok(first.every((minted) => minted.accessKeyId === "a1"));
  await credentials.mint(place, "write", "key:k1");
  await credentials.mint(place, "read", "key:k2");
  await credentials.mint(place, "read", "key:k1", ["main"]);
  assert.equal(calls, 4, "other access, caller or protected branches mint anew");

  expires = Date.now() + 300_000;
  const short = new Credentials(sts, "us-east-1", { accessKeyId: "a", secretAccessKey: "s" });
  await short.mint(place, "read", "key:k1");
  await short.mint(place, "read", "key:k1");
  assert.equal(calls, 6);
});

test("minted credentials last 15 minutes unless set, and an hour at most", () => {
  const base = {
    SKYWAKE_API_DATABASE: "postgres://x",
    SKYWAKE_STORE: "/tmp/x",
    SKYWAKE_API_STS_ROLE_ARN: "arn:aws:iam::1:role/r",
  };
  assert.equal(loadConfig(base).sts?.seconds, 900);
  assert.equal(loadConfig({ ...base, SKYWAKE_API_STS_SECONDS: "3600" }).sts?.seconds, 3600);
  assert.throws(() => loadConfig({ ...base, SKYWAKE_API_STS_SECONDS: "3601" }));
});

test(
  "credentials for another org's public namespace are in both orgs' audit logs",
  { skip },
  async () => {
    const asked: unknown[] = [];
    const credentials = {
      mint: async (...args: unknown[]) => {
        asked.push(args);
        return {
          accessKeyId: "a",
          secretAccessKey: "s",
          sessionToken: "t",
          expiresAt: "2030-01-01T00:00:00.000Z",
        };
      },
    } as unknown as Credentials;
    const s = await server(
      { regions: [["local", `s3://skywake/api-test-${unique()}`]] },
      { credentials },
    );
    const owner = await s.org();
    const other = await s.org();
    const made = await s.call("POST", "/namespaces", owner.key, {
      name: "docs",
      visibility: "public",
    });
    assert.equal(made.status, 201);
    const ref = `/namespaces/${owner.id}:docs/credentials`;
    assert.equal((await s.call("POST", ref, other.key, { access: "write" })).status, 404);
    assert.equal((await s.call("POST", ref, other.key, { access: "read" })).status, 200);

    const events = async (key: string) =>
      (await s.call("GET", "/audit?action=createCredentials", key)).body.events;
    const theirs = await events(other.key);
    const ours = await events(owner.key);
    assert.deepEqual(
      theirs.map((e: any) => [e.outcome, e.details?.access ?? null]),
      [
        ["ok", "read"],
        ["rejected", null],
      ],
    );
    assert.equal(ours.length, 1, "the owner sees the read that worked, not the refused write");
    assert.equal(ours[0].id, theirs[0].id);
    assert.deepEqual([ours[0].org, ours[0].owner], [other.id, owner.id]);
    assert.equal(ours[0].resource.namespace, `${owner.id}:docs`);
  },
);

test("without an STS role the server says it cannot mint credentials", { skip }, async () => {
  const s = await server();
  const { key } = await s.ready();
  const answer = await s.call("POST", `${NS}/credentials`, key, { access: "read" });
  assert.equal(answer.status, 501);
  assert.equal(answer.body.code, "not_implemented");
});

const S3 = "http://localhost:9100";
const DEV = { accessKeyId: "skywake", secretAccessKey: "skywake-dev" };
const reachable = await fetch(S3).then(
  () => true,
  () => false,
);

test(
  "minted credentials reach the namespace's prefix and nothing else",
  { skip: skip || (!reachable && "needs the local RustFS on :9100") },
  async (t) => {
    const sts = { roleArn: "arn:aws:iam::000000000000:role/skywake", endpoint: S3, seconds: 900 };
    const credentials = new Credentials(sts, "us-east-1", DEV);
    const s = await server(
      {
        regions: [["local", `s3://skywake/api-test-${unique()}`]],
        s3: { region: "us-east-1", endpoint: S3 },
        sts,
      },
      { credentials },
    );
    const { id, key } = await s.org();
    assert.equal((await s.call("POST", "/namespaces", key, { name: "prod/app" })).status, 201);
    const main = { org: id, namespace: "prod/app", name: "main" };
    await branches.add(s.db, main, null);
    await branches.protect(s.db, main, true);
    const reader = (await s.call("POST", "/keys", key, { name: "r", role: "read" })).body.key;
    assert.equal(
      (await s.call("POST", `${NS}/credentials`, reader, { access: "write" })).status,
      403,
    );

    const minted = await s.call("POST", `${NS}/credentials`, key, { access: "write" });
    if (minted.status === 500) return t.skip("this RustFS does not answer STS AssumeRole");
    assert.equal(minted.status, 200, JSON.stringify(minted.body));
    const body = minted.body;
    assert.equal(body.access, "write");
    assert.equal(body.region, "us-east-1");
    assert.equal(body.endpoint, S3);
    assert.ok(Date.parse(body.expiresAt) >= Date.now() + 14 * 60_000);
    const [, bucket, prefix] = /^s3:\/\/([^/]+)\/(.+)$/.exec(body.store)!;
    assert.equal(bucket, "skywake");

    const client = (answer: any) =>
      new S3Client({
        region: "us-east-1",
        endpoint: S3,
        forcePathStyle: true,
        credentials: {
          accessKeyId: answer.accessKeyId,
          secretAccessKey: answer.secretAccessKey,
          sessionToken: answer.sessionToken,
        },
      });
    const writer = client(body);
    const put = (s3: S3Client, Key: string) =>
      s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: "x" })).then(
        () => "allowed",
        (error) => error.name,
      );
    assert.equal(await put(writer, `${prefix}/probe`), "allowed");
    assert.equal(await put(writer, `${prefix}-other/probe`), "AccessDenied");
    assert.equal(await put(writer, "elsewhere/probe"), "AccessDenied");
    assert.equal(await put(writer, `${prefix}/refs/fix`), "allowed");
    assert.equal(await put(writer, `${prefix}/refs/main`), "AccessDenied");
    assert.equal(await put(writer, `${prefix}/gc/lock`), "AccessDenied");
    const removed = await writer
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: `${prefix}/probe` }))
      .then(
        () => "allowed",
        (error) => error.name,
      );
    assert.equal(removed, "AccessDenied");

    const read = await s.call("POST", `${NS}/credentials`, reader, { access: "read" });
    assert.equal(read.status, 200);
    const readOnly = client(read.body);
    assert.equal(await put(readOnly, `${prefix}/probe`), "AccessDenied");
    const got = await readOnly.send(
      new GetObjectCommand({ Bucket: bucket, Key: `${prefix}/probe` }),
    );
    assert.equal(await got.Body!.transformToString(), "x");
  },
);
