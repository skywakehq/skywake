import assert from "node:assert/strict";
import { test } from "node:test";

import { APIError } from "better-auth/api";

import { leaverOf, revokeKeysOf } from "../server/member-keys.ts";

process.env.SKYWAKE_API_URL = "http://api.test/v1";
process.env.SKYWAKE_API_ADMIN_TOKEN = "admin-token";

test("leaving revokes the person's keys through the API's admin route", async () => {
  const sent: [string, RequestInit | undefined][] = [];
  const send = (async (url: string, init?: RequestInit) => {
    sent.push([url, init]);
    return Response.json({ revoked: 2 });
  }) as typeof fetch;
  await revokeKeysOf("org_1", "user 1", send);
  assert.equal(sent[0]![0], "http://api.test/v1/orgs/org_1/members/user%201/keys");
  assert.equal(sent[0]![1]?.method, "DELETE");
  assert.deepEqual(sent[0]![1]?.headers, { authorization: "Bearer admin-token" });
});

test("a revocation the API refuses is an error, not silence", async () => {
  const refuse = (async () => new Response("no", { status: 500 })) as typeof fetch;
  await assert.rejects(revokeKeysOf("org_1", "u", refuse), /could not be revoked/);
  const down = (async () => {
    throw new Error("connection refused");
  }) as typeof fetch;
  await assert.rejects(revokeKeysOf("org_1", "u", down), /could not be revoked/);
});

test("only a leave that went through names who left", () => {
  const session = { user: { id: "u1" } };
  const left = {
    path: "/organization/leave",
    body: { organizationId: "o1" },
    context: { session },
  };
  assert.deepEqual(leaverOf(left), { org: "o1", user: "u1" });
  const refused = { ...left, context: { session, returned: new APIError("BAD_REQUEST") } };
  assert.equal(leaverOf(refused), null);
  assert.equal(leaverOf({ ...left, path: "/organization/remove-member" }), null);
});
