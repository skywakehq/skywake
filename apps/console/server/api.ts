import "server-only";

import { auth } from "./auth";
import type { Caller } from "./caller";

const URL = process.env.SKYWAKE_API_URL;

/**
 * Calls the API as the caller, with a short-lived signed token. `orgs` names
 * other organizations of the person, with their role there, for calls that
 * reach across organizations.
 */
export async function skywake(
  caller: Caller,
  path: string,
  init: RequestInit & { duplex?: "half" } = {},
  orgs?: Record<string, string>,
  base = URL,
) {
  const payload = {
    sub: caller.userID,
    org: caller.org,
    role: caller.role,
    email: caller.email,
    // The API refuses tokens without it where the organization requires single sign-on.
    ...(caller.ssoOrg ? { sso: caller.ssoOrg } : {}),
    // The API checks the organization's IP allowlist against it.
    ...(caller.ip ? { ip: caller.ip } : {}),
    ...(orgs ? { orgs } : {}),
  };
  const { token } = await auth.api.signJWT({ body: { payload } });
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (caller.userAgent) headers.set("user-agent", caller.userAgent);
  // So the API's limit per address counts each person's own address, not the
  // console's one address for everyone. It is read only when the API trusts
  // the hop in front of it (SKYWAKE_API_TRUST_PROXY), which then is this console.
  if (caller.ip) headers.set("x-forwarded-for", caller.ip);
  return fetch(`${base}${path}`, { ...init, headers, cache: "no-store" });
}

const V2 = URL?.replace(/\/v1\/?$/, "/v2");

export async function skywakeV2(caller: Caller, env: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("skywake-environment", env);
  return skywake(caller, path, { ...init, headers }, undefined, V2);
}

/** Like `skywake`, but sends JSON and throws the API's message on failure. */
export async function skywakeJSON(caller: Caller, path: string, method: string, body?: unknown) {
  const response = await skywake(caller, path, { method, body: JSON.stringify(body ?? {}) });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok && response.status !== 409) throw new Error(data?.error ?? response.statusText);
  return { status: response.status, data };
}

/** The person's role in `org`, or null if they are not in it. */
export async function roleIn(caller: Caller, org: string) {
  const ctx = await auth.$context;
  const member = await ctx.adapter.findOne<{ role: string }>({
    model: "member",
    where: [
      { field: "userId", value: caller.userID },
      { field: "organizationId", value: org },
    ],
  });
  return member?.role ?? null;
}

/** A namespace or branch name as it goes in an API path. */
export const part = encodeURIComponent;
