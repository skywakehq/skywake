import assert from "node:assert/strict";
import { test } from "node:test";

import { APIError } from "better-auth/api";

import { membershipOf } from "../server/membership.ts";

test("someone removed from the organization has no membership", async () => {
  const removed = async () => {
    throw new APIError("BAD_REQUEST", { message: "Member not found" });
  };
  assert.equal(await membershipOf(removed), null);
});

test("a member keeps their role", async () => {
  assert.deepEqual(await membershipOf(async () => ({ role: "admin" })), { role: "admin" });
});

test("other failures are not taken for signing out", async () => {
  const down = async () => {
    throw new Error("the database is down");
  };
  await assert.rejects(membershipOf(down), /database is down/);
});
