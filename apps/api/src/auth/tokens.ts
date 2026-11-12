import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface TokenClaims {
  sub: string;
  org: string;
  role: string;
  email?: string;
  /** The organization whose single sign-on the person signed in through, if any. */
  sso?: string;
  /** Where the person calls the console from, as the console saw it. */
  ip?: string;
  /** Other organizations the person is in, with their role there. */
  orgs?: Record<string, string>;
}

const ALGORITHMS = ["EdDSA", "RS256", "ES256"];

export class ConsoleTokens {
  readonly #keys: JWTVerifyGetKey;
  readonly #issuer: string;
  readonly #audience: string;

  constructor(keys: JWTVerifyGetKey, options: { issuer: string; audience: string }) {
    this.#keys = keys;
    this.#issuer = options.issuer;
    this.#audience = options.audience;
  }

  static remote(url: string, options: { issuer: string; audience: string }) {
    return new ConsoleTokens(
      createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000 }),
      options,
    );
  }

  async verify(token: string): Promise<TokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.#keys, {
        algorithms: ALGORITHMS,
        issuer: this.#issuer,
        audience: this.#audience,
        // A token that never expires could never be taken back.
        requiredClaims: ["exp"],
      });
      const { sub, org, role, email, sso, ip, orgs } = payload;
      if (typeof sub !== "string" || typeof org !== "string" || typeof role !== "string")
        return null;
      return {
        sub,
        org,
        role,
        email: typeof email === "string" ? email : undefined,
        sso: typeof sso === "string" ? sso : undefined,
        ip: typeof ip === "string" ? ip : undefined,
        orgs: roles(orgs),
      };
    } catch {
      return null;
    }
  }
}

/** A claim of `{ org: role }`, or undefined if it is not one. */
function roles(claim: unknown) {
  if (typeof claim !== "object" || claim === null || Array.isArray(claim)) return undefined;
  const entries = Object.entries(claim).filter(([, role]) => typeof role === "string");
  return Object.fromEntries(entries) as Record<string, string>;
}
