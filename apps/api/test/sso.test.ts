import assert from "node:assert/strict";
import { test } from "node:test";

import { ADMIN, server, skip, token } from "./helpers.ts";

test("only the admin token sets which domains must use single sign-on", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.org();
  const policy = { required_domains: ["example.com"] };

  assert.equal((await s.call("PUT", `/orgs/${id}/sso`, key, policy)).status, 401);
  const member = await token(id, "owner", "test", "1m", { email: "a@example.com", sso: id });
  assert.equal((await s.call("PUT", `/orgs/${id}/sso`, member, policy)).status, 401);
  assert.equal((await s.call("PUT", "/orgs/org_missing/sso", ADMIN, policy)).status, 404);
  const bad = await s.call("PUT", `/orgs/${id}/sso`, ADMIN, { required_domains: ["no domain"] });
  assert.equal(bad.status, 400);

  const set = await s.call("PUT", `/orgs/${id}/sso`, ADMIN, {
    required_domains: ["example.com", "example.com", "b.example.org"],
  });
  assert.deepEqual(set.body, { required_domains: ["b.example.org", "example.com"] });
  const got = await s.call("GET", `/orgs/${id}/sso`, ADMIN);
  assert.deepEqual(got.body, set.body);

  // The console asks which organizations require it for a domain.
  assert.equal((await s.call("GET", "/sso/domains/example.com", key)).status, 401);
  const orgs = await s.call("GET", "/sso/domains/EXAMPLE.com", ADMIN);
  assert.ok(orgs.body.orgs.includes(id));
});

test(
  "console tokens must come from single sign-on where the org asks for it",
  { skip },
  async () => {
    const s = await server();
    const { id, key } = await s.org();
    const as = (claims: Record<string, unknown>) => token(id, "owner", "test", "1m", claims);

    // Before the policy, any sign-in works.
    const password = await as({ email: "ada@example.com" });
    assert.equal((await s.call("GET", "/namespaces", password)).status, 200);

    await s.call("PUT", `/orgs/${id}/sso`, ADMIN, { required_domains: ["example.com"] });

    const refused = await s.call("GET", "/namespaces", password);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /single sign-on/);
    // Single sign-on through another organization does not count.
    const elsewhere = await as({ email: "ada@example.com", sso: "org_other" });
    assert.equal((await s.call("GET", "/namespaces", elsewhere)).status, 403);
    // Domains are compared without case.
    assert.equal(
      (await s.call("GET", "/namespaces", await as({ email: "Ada@EXAMPLE.com" }))).status,
      403,
    );
    // A token without an email is refused once any domain needs single sign-on.
    assert.equal((await s.call("GET", "/namespaces", await as({}))).status, 403);

    const sso = await as({ email: "ada@example.com", sso: id });
    assert.equal((await s.call("GET", "/namespaces", sso)).status, 200);
    // People from other domains, such as contractors, still sign in as before.
    const other = await as({ email: "sam@contractor.dev" });
    assert.equal((await s.call("GET", "/namespaces", other)).status, 200);
    // API keys are for programs and are not affected.
    assert.equal((await s.call("GET", "/namespaces", key)).status, 200);

    await s.call("PUT", `/orgs/${id}/sso`, ADMIN, { required_domains: [] });
    assert.equal((await s.call("GET", "/namespaces", password)).status, 200);
  },
);
