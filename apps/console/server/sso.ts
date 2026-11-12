import "server-only";

import { lookup } from "node:dns/promises";
import { randomBytes, X509Certificate } from "node:crypto";
import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import { X509CertificateGenerator } from "@peculiar/x509";
import { SPMetadata } from "samlify";
import { allowedDomains, auth } from "./auth";
import { caller, type Caller } from "./caller";
import { authPool } from "./db";
import { domainOf, forgetSsoOrgs, PRIVATE_IDP_ORIGINS } from "./sso-policy";
import { verifyFailure } from "./sso-verify";
import { withBase } from "@/lib/zone";

// Single sign-on connections of an organization, kept by Better Auth's SSO
// plugin. Its own routes for this are turned off; these add the checks it
// leaves to us: admins only, signed assertions always, and "require SSO".

export type Connection = {
  id: string;
  type: "saml" | "oidc";
  domains: string[];
  issuer: string;
  verified: boolean;
  enabled: boolean;
  required: boolean;
  /** The DNS record that proves the domains, until they are proved. */
  dns: { name: string; value: string }[] | null;
  /** What to copy into the identity provider. */
  sp: Record<string, string>;
  clientId?: string;
};

type Row = {
  id: string;
  providerId: string;
  issuer: string;
  domain: string;
  domainVerified: boolean;
  enabled: boolean;
  organizationId: string | null;
  oidcConfig: string | null;
  samlConfig: string | null;
};

const BASE = `${process.env.BETTER_AUTH_URL}${withBase("/api/auth")}`;
const PREFIX = "skywake-sso";

export class SsoError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Runs `run` for an admin of the caller's organization, answering JSON. */
export async function admin(request: Request, run: (who: Caller) => Promise<unknown>) {
  const who = await caller(request.headers);
  if (!who) return Response.json({ error: "sign in first" }, { status: 401 });
  if (who.role !== "owner" && who.role !== "admin")
    return Response.json({ error: "only admins manage SSO" }, { status: 403 });
  try {
    return Response.json((await run(who)) ?? {});
  } catch (error) {
    const status = error instanceof SsoError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Something went wrong";
    return Response.json({ error: message }, { status });
  }
}

async function rows(org: string) {
  const ctx = await auth.$context;
  return ctx.adapter.findMany<Row>({
    model: "ssoProvider",
    where: [{ field: "organizationId", value: org }],
    sortBy: { field: "providerId", direction: "asc" },
  });
}

async function row(org: string, id: string) {
  const found = (await rows(org)).find((r) => r.providerId === id);
  if (!found) throw new SsoError("No such connection", 404);
  return found;
}

export async function list(who: Caller, headers: Headers): Promise<Connection[]> {
  const required = await requiredDomains(who.org);
  return Promise.all(
    (await rows(who.org)).map(async (r): Promise<Connection> => {
      const domains = allowedDomains(r);
      const saml = r.samlConfig !== null;
      let dns: Connection["dns"] = null;
      if (!r.domainVerified) {
        const { domainVerificationToken: token } = await auth.api.requestDomainVerification({
          body: { providerId: r.providerId },
          headers,
        });
        const name = `_${PREFIX}-${r.providerId}`;
        dns = domains.map((domain) => ({ name: `${name}.${domain}`, value: `${name}=${token}` }));
      }
      return {
        id: r.providerId,
        type: saml ? "saml" : "oidc",
        domains,
        issuer: saml ? idpEntityId(JSON.parse(r.samlConfig!).idpMetadata) : r.issuer,
        verified: r.domainVerified,
        enabled: r.enabled,
        required: domains.some((domain) => required.includes(domain)),
        dns,
        sp: saml
          ? {
              "ACS URL": acsUrl(r.providerId),
              "Entity ID": spEntityId(r.providerId),
              "SP metadata": spEntityId(r.providerId),
            }
          : { "Redirect URI": `${BASE}/sso/callback/${r.providerId}` },
        clientId: r.oidcConfig ? JSON.parse(r.oidcConfig).clientId : undefined,
      };
    }),
  );
}

const idpEntityId = (idp?: { entityID?: string; metadata?: string }) =>
  idp?.entityID ?? /entityID="([^"]+)"/.exec(idp?.metadata ?? "")?.[1] ?? "";

// The SP metadata URL doubles as the entity id, as Okta and Entra expect.
const spEntityId = (id: string) => `${BASE}/sso/saml2/sp/metadata?providerId=${id}`;
const acsUrl = (id: string) => `${BASE}/sso/saml2/sp/acs/${id}`;
const EMAIL_FORMAT = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
const POST_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";

/** A key of the connection's own to sign its requests, and its certificate for the IdP. */
async function signingKey(providerId: string) {
  const algorithm = {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    publicExponent: new Uint8Array([1, 0, 1]),
    modulusLength: 2048,
  };
  const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const cert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(8).toString("hex"),
    name: `CN=Skywake SSO ${providerId}`,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 10 * 365 * 86_400_000),
    signingAlgorithm: algorithm,
    keys,
  });
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  const lines = pkcs8
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n");
  return {
    privateKey: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`,
    cert: cert.toString("pem"),
  };
}

export type NewConnection =
  | { type: "saml"; domains: string; metadata: string }
  | { type: "oidc"; domains: string; issuer: string; clientId: string; clientSecret: string };

export async function create(who: Caller, headers: Headers, input: NewConnection) {
  const domains = parseDomains(input.domains);
  const providerId = `${input.type}-${randomBytes(5).toString("hex")}`;
  const common = { providerId, domain: domains.join(","), organizationId: who.org };
  if (input.type === "saml") {
    const metadata = /^https?:\/\//.test(input.metadata.trim())
      ? await (await fetchIdp(input.metadata.trim())).text()
      : input.metadata.trim();
    const idp = readIdpMetadata(metadata);
    const signing = await signingKey(providerId);
    await auth.api.registerSSOProvider({
      headers,
      body: {
        ...common,
        issuer: spEntityId(providerId),
        samlConfig: {
          entryPoint: idp.ssoUrl,
          idpMetadata: { metadata },
          // Never accept an assertion that the IdP did not sign.
          wantAssertionsSigned: true,
          // Requests are signed when the IdP asks; samlify needs both sides to agree.
          authnRequestsSigned: idp.wantsSignedRequests,
          identifierFormat: EMAIL_FORMAT,
          spMetadata: {
            privateKey: signing.privateKey,
            metadata: SPMetadata({
              entityID: spEntityId(providerId),
              assertionConsumerService: [{ Binding: POST_BINDING, Location: acsUrl(providerId) }],
              wantAssertionsSigned: true,
              authnRequestsSigned: idp.wantsSignedRequests,
              signingCert: signing.cert,
              nameIDFormat: [EMAIL_FORMAT],
            }).getMetadata(),
          },
        },
      },
    });
  } else {
    const issuer = input.issuer.trim().replace(/\/$/, "");
    const doc = await discover(issuer);
    await auth.api.registerSSOProvider({
      headers,
      body: {
        ...common,
        issuer,
        oidcConfig: {
          clientId: input.clientId.trim(),
          clientSecret: input.clientSecret,
          // We fetched the document ourselves, with the checks above.
          skipDiscovery: true,
          authorizationEndpoint: doc.authorization_endpoint,
          tokenEndpoint: doc.token_endpoint,
          jwksEndpoint: doc.jwks_uri,
          userInfoEndpoint: doc.userinfo_endpoint,
          scopes: ["openid", "email", "profile"],
          pkce: true,
        },
      },
    });
  }
  // Domains the operator vouches for, and their subdomains, need no DNS record.
  const vouched = (domain: string) =>
    VERIFIED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
  if (domains.every(vouched)) {
    await setFields(who.org, providerId, { domainVerified: true });
  }
  return providerId;
}

const VERIFIED_DOMAINS = (process.env.SSO_VERIFIED_DOMAINS ?? "")
  .split(",")
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);

export async function verify(who: Caller, headers: Headers, id: string) {
  const provider = await row(who.org, id);
  try {
    await auth.api.verifyDomain({ body: { providerId: id }, headers });
  } catch (error) {
    throw new SsoError(verifyFailure(error, id, provider.domain));
  }
}

export async function update(
  who: Caller,
  id: string,
  change: { enabled?: boolean; required?: boolean },
) {
  const r = await row(who.org, id);
  const domains = allowedDomains(r);
  if (change.enabled === true && !r.domainVerified) {
    throw new SsoError("Verify the domain before you turn the connection on");
  }
  if (change.enabled === false || change.required !== undefined) {
    let required = await requiredDomains(who.org);
    if (change.required) {
      if (!r.enabled || !r.domainVerified) {
        throw new SsoError("Turn the connection on before you require it");
      }
      // Whoever turns this on must have signed in through it, so they know it works.
      if (domains.includes(domainOf(who.email) ?? "") && who.ssoOrg !== who.org) {
        throw new SsoError("Sign in with SSO once before you require it", 409);
      }
      required = [...required, ...domains];
    } else {
      required = required.filter((domain) => !domains.includes(domain));
    }
    await setRequiredDomains(who.org, required);
    if (change.required) await endOtherSessions(who.org, domains);
  }
  if (change.enabled !== undefined) await setFields(who.org, id, { enabled: change.enabled });
}

export async function remove(who: Caller, headers: Headers, id: string) {
  await update(who, id, { required: false });
  await auth.api.deleteSSOProvider({ body: { providerId: id }, headers });
}

/** Checks a connection can work, without signing anyone in. */
export async function test(who: Caller, id: string) {
  const r = await row(who.org, id);
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = async (name: string, run: () => Promise<string> | string) => {
    try {
      checks.push({ name, ok: true, detail: await run() });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : "failed" });
    }
  };
  if (r.samlConfig) {
    const metadata = JSON.parse(r.samlConfig).idpMetadata?.metadata ?? "";
    await check("IdP metadata", () => `Signs in at ${readIdpMetadata(metadata).ssoUrl}`);
    await check("Signing certificate", () => {
      const { certs } = readIdpMetadata(metadata);
      const until = Math.max(...certs.map((cert) => Date.parse(cert.validTo)));
      if (until < Date.now()) throw new SsoError("Every signing certificate has expired");
      return `Valid until ${new Date(until).toDateString()}`;
    });
  } else {
    await check("Discovery", async () => {
      await discover(r.issuer);
      return `Found ${r.issuer}/.well-known/openid-configuration`;
    });
    await check("Signing keys", async () => {
      const keys = await (await fetchIdp((await discover(r.issuer)).jwks_uri)).json();
      if (!Array.isArray(keys.keys) || keys.keys.length === 0) throw new SsoError("No keys");
      return `${keys.keys.length} key${keys.keys.length === 1 ? "" : "s"}`;
    });
  }
  await check("Domain", () => {
    if (!r.domainVerified) throw new SsoError("Not verified yet: add the DNS record");
    return `Verified: ${allowedDomains(r).join(", ")}`;
  });
  return checks;
}

function parseDomains(text: string) {
  const domains = [...new Set(text.split(/[\s,]+/).filter(Boolean))].map((d) => d.toLowerCase());
  const valid = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (domains.length === 0 || !domains.every((domain) => valid.test(domain))) {
    throw new SsoError("Give one or more email domains, like example.com");
  }
  return domains;
}

/** Reads what we need from IdP metadata. The plugin checks it fully when it is saved. */
function readIdpMetadata(xml: string) {
  if (!/EntityDescriptor/.test(xml)) throw new SsoError("That is not SAML metadata");
  const services = [...xml.matchAll(/<(?:\w+:)?SingleSignOnService\b[^>]*>/g)].map((m) => m[0]);
  const redirect = services.find((tag) => tag.includes("HTTP-Redirect")) ?? services[0];
  const ssoUrl = redirect?.match(/Location="([^"]+)"/)?.[1];
  if (!ssoUrl) throw new SsoError("The metadata has no sign-in URL (SingleSignOnService)");
  const certs = [...xml.matchAll(/<(?:\w+:)?X509Certificate>([^<]+)</g)].map(
    (m) =>
      new X509Certificate(
        `-----BEGIN CERTIFICATE-----\n${m[1]!.trim()}\n-----END CERTIFICATE-----`,
      ),
  );
  if (certs.length === 0) throw new SsoError("The metadata has no signing certificate");
  const wantsSignedRequests = /WantAuthnRequestsSigned="(true|1)"/.test(xml);
  return { ssoUrl, certs, wantsSignedRequests };
}

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
};

async function discover(issuer: string): Promise<Discovery> {
  const doc = (await (
    await fetchIdp(`${issuer}/.well-known/openid-configuration`)
  ).json()) as Discovery;
  if (doc.issuer?.replace(/\/$/, "") !== issuer) {
    throw new SsoError(`The provider calls itself ${doc.issuer}, not ${issuer}`);
  }
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new SsoError("The discovery document is missing endpoints");
  }
  return doc;
}

/**
 * Fetches from an identity provider: over HTTPS to a public address, or from
 * an origin the operator listed in SSO_PRIVATE_IDP_ORIGINS. This keeps a
 * connection's URL from reaching services inside our own network.
 */
async function fetchIdp(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsoError(`Not a URL: ${url}`);
  }
  if (!PRIVATE_IDP_ORIGINS.includes(parsed.origin)) {
    if (parsed.protocol !== "https:") throw new SsoError("Identity provider URLs must use https");
    const addresses = await lookup(parsed.hostname, { all: true }).catch(() => []);
    if (addresses.length === 0 || !addresses.every((a) => isPublicRoutableHost(a.address))) {
      throw new SsoError(`${parsed.hostname} is not a public address`);
    }
  }
  const response = await fetch(parsed, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  }).catch(() => {
    throw new SsoError(`Could not reach ${parsed.origin}`);
  });
  if (!response.ok) throw new SsoError(`${parsed.href} answered ${response.status}`);
  return response;
}

async function setFields(org: string, id: string, update: Partial<Row>) {
  const ctx = await auth.$context;
  await ctx.adapter.update({
    model: "ssoProvider",
    where: [
      { field: "providerId", value: id },
      { field: "organizationId", value: org },
    ],
    update,
  });
}

// The API keeps the "require SSO" policy and enforces it on every request.
async function api(org: string, init?: RequestInit) {
  const response = await fetch(`${process.env.SKYWAKE_API_URL}/orgs/${org}/sso`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.SKYWAKE_API_ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new SsoError(`The API refused: ${await response.text()}`, 502);
  return ((await response.json()) as { required_domains: string[] }).required_domains;
}

const requiredDomains = (org: string) => api(org);
async function setRequiredDomains(org: string, domains: string[]) {
  await api(org, {
    method: "PUT",
    body: JSON.stringify({ required_domains: [...new Set(domains)] }),
  });
  forgetSsoOrgs();
}

/** Signs out people of these domains whose sessions did not come from this org's SSO. */
async function endOtherSessions(org: string, domains: string[]) {
  await authPool.query(
    `DELETE FROM "session" s USING "user" u
      WHERE s."userId" = u.id
        AND lower(split_part(u.email, '@', 2)) = ANY($1)
        AND s."ssoOrg" IS DISTINCT FROM $2`,
    [domains, org],
  );
}
