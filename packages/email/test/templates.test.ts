import assert from "node:assert/strict";
import { test } from "node:test";

import { invitation, resetPassword, verifyEmail, waitlist } from "../src/index.ts";

const url = "https://console.example.com/api/auth/verify-email?token=abc&callbackURL=%2F";

test("the verify email links to the URL in both HTML and text", () => {
  const email = verifyEmail({ url });
  assert.equal(email.subject, "Verify your email for Skywake");
  assert.ok(email.html.startsWith("<!doctype html>"));
  assert.ok(email.html.includes(`href="${url.replaceAll("&", "&amp;")}"`));
  assert.ok(email.text.includes(`Verify email: ${url}`));
  assert.ok(!email.text.includes("<"));
});

test("the reset email names its action", () => {
  const email = resetPassword({ url });
  assert.equal(email.subject, "Reset your Skywake password");
  assert.ok(email.html.includes("Choose a new password"));
  assert.ok(email.text.includes(`Choose a new password: ${url}`));
});

test("the invitation names the organization, the inviter and the role", () => {
  const email = invitation({ org: "Acme", inviter: "Grace", role: "admin", url });
  assert.equal(email.subject, "Grace invited you to Acme on Skywake");
  assert.ok(email.text.includes("Grace invited you to the Acme organization as an admin."));
  assert.ok(
    invitation({ org: "Acme", inviter: "G", role: "member", url }).text.includes("as a member."),
  );
});

test("text from people is escaped in the HTML", () => {
  const email = invitation({ org: "<script>x</script>", inviter: 'Eve "E"', role: "member", url });
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("&lt;script&gt;x&lt;/script&gt;"));
  assert.ok(email.html.includes("Eve &quot;E&quot;"));
  assert.ok(email.text.includes("<script>x</script>"));
});

test("no account mail carries text a stranger wrote", () => {
  for (const email of [verifyEmail({ url }), resetPassword({ url })]) {
    assert.ok(!email.text.includes("Hi "), email.text);
  }
});

test("names in an invitation lose anything that could become a link", () => {
  const email = invitation({
    org: "Acme https://evil.test/login",
    inviter: "Eve, see www.evil.test or evil.example now",
    role: "member",
    url,
  });
  assert.ok(!/evil/.test(email.subject + email.text + email.html), email.text);
  assert.ok(email.text.includes("Eve, see or now invited you to the Acme organization"));
  assert.equal(
    invitation({ org: "x.io", inviter: "y", role: "admin", url }).subject,
    "y invited you to Someone on Skywake",
  );
});

test("the waitlist email points to self-hosting and carries nothing the person typed", () => {
  const selfHostUrl = "https://skywake.dev/docs/self-hosting/docker-compose";
  const email = waitlist({ selfHostUrl });
  assert.equal(email.subject, "You're on the Skywake Cloud waitlist");
  assert.ok(email.text.includes(`Self-host Skywake: ${selfHostUrl}`));
});
