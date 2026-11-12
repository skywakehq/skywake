import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyFailure } from "../server/sso-verify.ts";

test("a domain that fails to verify names the record to add", () => {
  const failed = Object.assign(new Error("Unable to verify domain ownership. Try again later"), {
    body: { code: "DOMAIN_VERIFICATION_FAILED" },
  });
  const said = verifyFailure(failed, "acme", "acme.com");
  assert.match(said, /_skywake-sso-acme\.acme\.com/);
  assert.doesNotMatch(said, /Try again later/);
  assert.equal(verifyFailure(new Error("Invalid domain"), "acme", "acme.com"), "Invalid domain");
});
