import assert from "node:assert/strict";
import { test } from "node:test";

import { ADMIN, post, unique } from "./api.ts";

test("only the admin creates organizations, and names are unique", async () => {
  const name = `o-${unique()}`;
  assert.equal((await post("/orgs", "wrong", { name })).status, 401);
  const created = await post("/orgs", ADMIN, { name });
  assert.equal(created.status, 201);
  assert.match(created.body.key, /^sw_[0-9a-f]{16}_[0-9a-f]{72}$/);
  assert.equal((await post("/orgs", ADMIN, { name })).status, 409);
});
