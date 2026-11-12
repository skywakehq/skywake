import assert from "node:assert/strict";
import { test } from "node:test";

import { authError, signInQuery } from "../lib/auth-error.ts";

test("a bad email link sends a signed-out person to sign-in with the reason", () => {
  const query = signInQuery(new URL("http://console.test/?error=INVALID_TOKEN"));
  assert.equal(query.get("next"), "/?error=INVALID_TOKEN");
  assert.equal(query.get("error"), "INVALID_TOKEN");
  assert.match(authError(query), /expired or was already used/);
  assert.equal(signInQuery(new URL("http://console.test/n/x")).get("error"), null);
});

test("other errors are shown as they came", () => {
  assert.equal(authError(new URLSearchParams("error=access_denied")), "access denied");
  assert.equal(authError(new URLSearchParams("error=x&error_description=No_way")), "No way");
  assert.equal(authError(new URLSearchParams("")), "");
});

test("a sign-in the identity provider started says where to start instead", () => {
  const query = new URLSearchParams(
    "error=unsolicited_response&error_description=IdP-initiated SSO not allowed",
  );
  assert.match(authError(query), /Start single sign-on from this page/);
});
