import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

/** Identity providers on a private network that the console may reach, by origin. */
export const PRIVATE_IDP_ORIGINS = (process.env.SSO_PRIVATE_IDP_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function domainOf(email: string) {
  const at = email.lastIndexOf("@");
  return at < 0
    ? null
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase() || null;
}

/** The organizations where people with this email must sign in through single sign-on. */
export async function ssoOrgsFor(email: string): Promise<string[]> {
  const domain = domainOf(email);
  if (!domain) return [];
  const cached = recent.get(domain);
  if (cached && cached.until > Date.now()) return cached.orgs;
  // The API keeps the policy; the console reaches it only over HTTP.
  const response = await fetch(
    `${process.env.SKYWAKE_API_URL}/sso/domains/${encodeURIComponent(domain)}`,
    {
      headers: { authorization: `Bearer ${process.env.SKYWAKE_API_ADMIN_TOKEN}` },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`the API did not answer for ${domain}: ${response.status}`);
  const { orgs } = (await response.json()) as { orgs: string[] };
  recent.set(domain, { orgs, until: Date.now() + CACHE_MS });
  return orgs;
}

// Every console request checks the policy, so answers are kept a few seconds.
// Turning "require SSO" on also ends the sessions it affects at once.
const CACHE_MS = 5_000;
const recent = new Map<string, { orgs: string[]; until: number }>();

/** Forgets cached answers, after the policy changes here. */
export const forgetSsoOrgs = () => recent.clear();

const SEALED = "sealed:";
const key = () => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is needed to keep SSO secrets");
  return secret;
};

/** The secrets in a stored connection config: an OIDC client secret, a SAML signing key. */
type Secrets = { clientSecret?: string; spMetadata?: { privateKey?: string } };

async function eachSecret(json: string, change: (value: string) => Promise<string>) {
  const config = JSON.parse(json) as Secrets;
  if (typeof config.clientSecret === "string") {
    config.clientSecret = await change(config.clientSecret);
  }
  if (typeof config.spMetadata?.privateKey === "string") {
    config.spMetadata.privateKey = await change(config.spMetadata.privateKey);
  }
  return JSON.stringify(config);
}

/** A connection config as stored: the same JSON, with its secrets encrypted. */
export const sealSecrets = (json: string) =>
  eachSecret(json, async (value) =>
    value.startsWith(SEALED)
      ? value
      : SEALED + (await symmetricEncrypt({ key: key(), data: value })),
  );

export const openSecrets = (json: string) =>
  eachSecret(json, async (value) =>
    value.startsWith(SEALED)
      ? symmetricDecrypt({ key: key(), data: value.slice(SEALED.length) })
      : value,
  );
