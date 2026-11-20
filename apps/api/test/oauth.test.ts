import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";

import { server, skip, token } from "./helpers.ts";

const CLIENT = "skywake-desktop";
const REDIRECT = "http://127.0.0.1:53682/callback";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function setup() {
  const s = await server();
  const { id: org } = await s.org();
  const post = async (path: string, body: unknown) => {
    const response = await s.app.request(`/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const approve = async (challenge: string, role = "admin", extra: object = {}) => {
    const person = await token(org, role);
    return s.call("POST", "/oauth/codes", person, {
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      device: "studio",
      environment: "prod",
      role: "write",
      ...extra,
    });
  };
  const exchange = (code: string, verifier: string, redirect = REDIRECT) =>
    post("/oauth/token", {
      grant_type: "authorization_code",
      client_id: CLIENT,
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
    });
  const refresh = (refresh_token: string) =>
    post("/oauth/token", { grant_type: "refresh_token", client_id: CLIENT, refresh_token });
  return { s, org, post, approve, exchange, refresh };
}

test("a code and its verifier give tokens that work, and refresh", { skip }, async () => {
  const { s, org, approve, exchange, refresh } = await setup();
  const { verifier, challenge } = pkce();
  const issued = await approve(challenge);
  assert.equal(issued.status, 201, JSON.stringify(issued.body));

  const tokens = await exchange(issued.body.code, verifier);
  assert.equal(tokens.status, 200, JSON.stringify(tokens.body));
  assert.equal(tokens.body.token_type, "Bearer");
  assert.equal(tokens.body.expires_in, 3600);
  assert.equal(tokens.body.organization.id, org);
  assert.deepEqual([tokens.body.environment, tokens.body.role], ["prod", "write"]);

  const me = await s.call("GET", "/whoami", tokens.body.access_token);
  assert.equal(me.status, 200);
  assert.deepEqual([me.body.environment, me.body.role], ["prod", "write"]);
  assert.ok(me.body.expires);

  // A code works once.
  assert.equal((await exchange(issued.body.code, verifier)).status, 400);

  const next = await refresh(tokens.body.refresh_token);
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.notEqual(next.body.access_token, tokens.body.access_token);
  assert.equal((await s.call("GET", "/whoami", tokens.body.access_token)).status, 401);
  assert.equal((await s.call("GET", "/whoami", next.body.access_token)).status, 200);
});

test("a wrong verifier or redirect gets nothing, and spends the code", { skip }, async () => {
  const { approve, exchange } = await setup();
  const { verifier, challenge } = pkce();
  const first = await approve(challenge);
  assert.equal((await exchange(first.body.code, pkce().verifier)).status, 400);
  assert.equal((await exchange(first.body.code, verifier)).status, 400);

  const second = await approve(challenge);
  const elsewhere = "http://127.0.0.1:9999/callback";
  assert.equal((await exchange(second.body.code, verifier, elsewhere)).status, 400);
});

test("only loopback redirects and S256 are taken", { skip }, async () => {
  const { approve } = await setup();
  const { challenge } = pkce();
  const remote = await approve(challenge, "admin", {
    redirect_uri: "https://evil.example/callback",
  });
  assert.equal(remote.status, 400);
  const plain = await approve(challenge, "admin", { code_challenge_method: "plain" });
  assert.equal(plain.status, 400);
  const other = await approve(challenge, "admin", { client_id: "someone-else" });
  assert.equal(other.status, 400);
});

test("a refresh token used twice ends the sign-in", { skip }, async () => {
  const { s, approve, exchange, refresh } = await setup();
  const { verifier, challenge } = pkce();
  const tokens = await exchange((await approve(challenge)).body.code, verifier);
  const next = await refresh(tokens.body.refresh_token);
  assert.equal(next.status, 200);
  assert.equal((await refresh(tokens.body.refresh_token)).status, 400);
  assert.equal((await refresh(next.body.refresh_token)).status, 400);
  assert.equal((await s.call("GET", "/whoami", next.body.access_token)).status, 401);
});

test("revoking ends the sign-in and its key", { skip }, async () => {
  const { s, post, approve, exchange, refresh } = await setup();
  const { verifier, challenge } = pkce();
  const tokens = await exchange((await approve(challenge)).body.code, verifier);
  const revoked = await post("/oauth/revoke", {
    client_id: CLIENT,
    token: tokens.body.refresh_token,
  });
  assert.equal(revoked.status, 204);
  assert.equal((await s.call("GET", "/whoami", tokens.body.access_token)).status, 401);
  assert.equal((await refresh(tokens.body.refresh_token)).status, 400);
  const unknown = await post("/oauth/revoke", { client_id: CLIENT, token: "swr_nope" });
  assert.equal(unknown.status, 204);
});

test("removing the app's key in the console signs it out", { skip }, async () => {
  const { s, org, approve, exchange, refresh } = await setup();
  const { verifier, challenge } = pkce();
  const tokens = await exchange((await approve(challenge)).body.code, verifier);
  const me = await s.call("GET", "/whoami", tokens.body.access_token);
  const admin = await token(org, "admin");
  assert.equal((await s.call("DELETE", `/keys/${me.body.key}`, admin)).status, 204);
  assert.equal((await refresh(tokens.body.refresh_token)).status, 400);
});

test(
  "a member can't give the app every environment, and a key can't approve",
  { skip },
  async () => {
    const { s, approve } = await setup();
    const { challenge } = pkce();
    const every = await approve(challenge, "member", { environment: null });
    assert.equal(every.status, 403);
    const { key } = await s.org();
    const byKey = await s.call("POST", "/oauth/codes", key, {
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      device: "studio",
      environment: "prod",
      role: "read",
    });
    assert.equal(byKey.status, 403);
  },
);
