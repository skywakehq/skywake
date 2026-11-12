// Real sign-ins through a local Keycloak (compose.yaml), over SAML and OIDC,
// and "require SSO" enforced by the console and the API.

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { Browser, CONSOLE, KEYCLOAK, owner, startSso, type Page } from "./browser.ts";

const REALM = `${KEYCLOAK}/realms/skywake`;

/** Signs in at Keycloak's own page, and lands back in the console. */
async function throughKeycloak(browser: Browser, email: string, password: string) {
  const started = await startSso(browser, email);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  // Keycloak asks for signed requests, so the console signs them.
  const url = new URL(started.body.url);
  if (url.searchParams.has("SAMLRequest")) assert.ok(url.searchParams.get("Signature"));
  let page: Page = await browser.go(started.body.url);
  assert.match(page.text, /kc-form-login/, "Keycloak's sign-in page");
  page = await browser.submit(page, { username: email, password });
  // SAML posts the response back through a form the page sends at once.
  if (/SAMLResponse/.test(page.text)) page = await browser.submit(page);
  return page;
}

async function keycloakAdmin() {
  const response = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: "admin",
      password: "admin",
    }),
  });
  const { access_token } = (await response.json()) as { access_token: string };
  return (path: string, body: unknown) =>
    fetch(`${KEYCLOAK}/admin/realms/skywake${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
}

/** What an admin does in Okta or Entra: copies the console's SP values into a new app. */
async function addSamlApp(sp: Record<string, string>) {
  const post = await keycloakAdmin();
  const response = await post("/clients", {
    clientId: sp["Entity ID"],
    protocol: "saml",
    enabled: true,
    redirectUris: [sp["ACS URL"]],
    attributes: {
      "saml.assertion.signature": "true",
      "saml.server.signature": "true",
      "saml.client.signature": "false",
      saml_force_name_id_format: "true",
      saml_name_id_format: "email",
      saml_assertion_consumer_url_post: sp["ACS URL"],
    },
    protocolMappers: [
      {
        name: "email",
        protocol: "saml",
        protocolMapper: "saml-user-property-mapper",
        config: { "user.attribute": "email", "attribute.name": "email" },
      },
    ],
  });
  assert.ok(response.status === 201 || response.status === 409, await response.text());
}

let admin: Awaited<ReturnType<typeof owner>>;
before(async () => {
  admin = await owner();
});

async function connections() {
  const listed = await admin.browser.json("GET", "/api/sso");
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  return listed.body as {
    id: string;
    type: string;
    enabled: boolean;
    verified: boolean;
    required: boolean;
    sp: Record<string, string>;
  }[];
}

async function turnOn(id: string) {
  const tested = await admin.browser.json("POST", `/api/sso/${id}?do=test`);
  assert.equal(tested.status, 200, JSON.stringify(tested.body));
  for (const check of tested.body.checks) assert.ok(check.ok, JSON.stringify(check));
  const on = await admin.browser.json("PATCH", `/api/sso/${id}`, { enabled: true });
  assert.equal(on.status, 200, JSON.stringify(on.body));
}

test("SAML: sign in through Keycloak, joining the organization", async () => {
  const made = await admin.browser.json("POST", "/api/sso", {
    type: "saml",
    domains: "example.com",
    metadata: `${REALM}/protocol/saml/descriptor`,
  });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const connection = (await connections()).find((c) => c.id === made.body.id)!;
  assert.equal(connection.type, "saml");
  assert.equal(connection.verified, true, "example.com is vouched for by the operator");
  assert.match(connection.sp["ACS URL"]!, /\/api\/auth\/sso\/saml2\/sp\/acs\//);

  // The SP metadata the admin copies asks for signed assertions.
  const metadata = await fetch(connection.sp["SP metadata"]!).then((r) => r.text());
  assert.match(metadata, /WantAssertionsSigned="true"/);

  await addSamlApp(connection.sp);
  const browser = new Browser();
  // Turned off, the connection signs no one in.
  assert.equal((await startSso(browser, "ada@example.com")).status, 404);
  await turnOn(connection.id);

  const landed = await throughKeycloak(browser, "ada@example.com", "ada-password");
  assert.equal(new URL(landed.url).origin, CONSOLE);
  const session = await browser.session();
  assert.equal(session?.user.email, "ada@example.com");
  assert.equal(session?.session.ssoOrg, admin.org);
  assert.equal(session?.session.activeOrganizationId, admin.org);

  // Just in time: Ada is now a member, and the API takes her token.
  const members = await admin.browser.json(
    "GET",
    `/api/auth/organization/list-members?organizationId=${admin.org}`,
  );
  const ada = members.body.members.find((m: any) => m.user.email === "ada@example.com");
  assert.equal(ada?.role, "member");
  assert.equal((await browser.json("GET", "/api/skywake/namespaces")).status, 200);
});

test("OIDC: sign in through Keycloak with a client id and secret", async () => {
  // Turn the SAML connection off so the email domain picks this one.
  for (const c of await connections()) {
    await admin.browser.json("PATCH", `/api/sso/${c.id}`, { enabled: false });
  }
  const made = await admin.browser.json("POST", "/api/sso", {
    type: "oidc",
    domains: "example.com",
    issuer: REALM,
    clientId: "skywake-oidc",
    clientSecret: "skywake-oidc-dev-secret",
  });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  await turnOn(made.body.id);

  const browser = new Browser();
  await throughKeycloak(browser, "ada@example.com", "ada-password");
  const session = await browser.session();
  assert.equal(session?.user.email, "ada@example.com");
  assert.equal(session?.session.ssoOrg, admin.org);

  // The IdP vouches only for its own domains.
  const mallory = new Browser();
  const started = await startSso(mallory, "mallory@example.com");
  let page = await mallory.go(started.body.url);
  page = await mallory.submit(page, { username: "mallory", password: "mallory-password" });
  assert.match(page.url, /error/);
  assert.equal(await mallory.session(), null);
});

test("require SSO: passwords stop working, for the console and the API", async () => {
  const [oidc] = (await connections()).filter((c) => c.type === "oidc" && c.enabled);
  assert.ok(oidc);

  // Two people of example.com sign up with passwords and join by invitation.
  async function join(email: string, role: string) {
    const browser = new Browser();
    const made = await browser.json("POST", "/api/auth/sign-up/email", {
      email,
      password: "a-long-password",
      name: email,
    });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const invite = await admin.browser.json("POST", "/api/auth/organization/invite-member", {
      email,
      role,
    });
    assert.equal(invite.status, 200, JSON.stringify(invite.body));
    const accepted = await browser.json("POST", "/api/auth/organization/accept-invitation", {
      invitationId: invite.body.id,
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    await browser.json("POST", "/api/auth/organization/set-active", { organizationId: admin.org });
    return browser;
  }
  const olive = await join("owner@example.com", "admin");
  const bob = await join("bob@example.com", "member");

  // Whoever requires SSO for their own domain must have used it first.
  const early = await olive.json("PATCH", `/api/sso/${oidc.id}`, { required: true });
  assert.equal(early.status, 409, JSON.stringify(early.body));

  // Signing in through the IdP proves the email: the password made before is gone.
  await throughKeycloak(olive, "owner@example.com", "owner-password");
  assert.equal((await olive.session())?.session.ssoOrg, admin.org);
  const oldPassword = await new Browser().json("POST", "/api/auth/sign-in/email", {
    email: "owner@example.com",
    password: "a-long-password",
  });
  assert.equal(oldPassword.status, 401);

  const required = await olive.json("PATCH", `/api/sso/${oidc.id}`, { required: true });
  assert.equal(required.status, 200, JSON.stringify(required.body));
  assert.equal((await connections()).find((c) => c.id === oidc.id)?.required, true);

  // Bob's password session ended, and passwords no longer sign anyone in.
  assert.equal(await bob.session(), null);
  const password = await new Browser().json("POST", "/api/auth/sign-in/email", {
    email: "bob@example.com",
    password: "a-long-password",
  });
  assert.equal(password.status, 403);
  assert.equal(password.body.code, "SSO_REQUIRED");
  const signUp = await new Browser().json("POST", "/api/auth/sign-up/email", {
    email: "new@example.com",
    password: "a-long-password",
    name: "New",
  });
  assert.equal(signUp.status, 403);

  // Olive's SSO session still reaches the API; so does the first admin, of another domain.
  assert.equal((await olive.json("GET", "/api/keys")).status, 200);
  assert.equal((await admin.browser.json("GET", "/api/keys")).status, 200);

  // The sign-in page learns to send example.com to SSO.
  const discover = await new Browser().json("GET", "/api/sso/discover?email=bob@example.com");
  assert.deepEqual(discover.body, { sso: true, required: true });

  // Turning it off lets passwords back in.
  await olive.json("PATCH", `/api/sso/${oidc.id}`, { required: false });
  const again = await new Browser().json("POST", "/api/auth/sign-in/email", {
    email: "bob@example.com",
    password: "a-long-password",
  });
  assert.equal(again.status, 200);
});
