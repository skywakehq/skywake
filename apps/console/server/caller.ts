import "server-only";

import { auth } from "./auth";
import { membershipOf } from "./membership";
import { ssoOrgsFor } from "./sso-policy";
import { addressOf } from "./address";

/** The signed-in person and the organization they are working in. */
export type Caller = {
  userID: string;
  email: string;
  org: string;
  role: string;
  /** The organization whose single sign-on made the session, if any. */
  ssoOrg: string | null;
  /** Where the person calls from, for the organization's IP allowlist. */
  ip: string | null;
  /** The person's browser, for the audit log. */
  userAgent: string | null;
};

/**
 * Who sent a request, or null if they are not signed in or have no
 * organization. `forwarded`: the request comes through zero-cache.
 */
export async function caller(headers: Headers, { forwarded = false } = {}): Promise<Caller | null> {
  const session = await auth.api.getSession({ headers });
  const org = session?.session.activeOrganizationId;
  if (!session || !org) return null;
  const ssoOrg = session.session.ssoOrg ?? null;
  // Sessions from before the organization turned on "require SSO" stop here.
  if (ssoOrg !== org && (await ssoOrgsFor(session.user.email)).includes(org)) return null;
  const member = await membershipOf(() => auth.api.getActiveMember({ headers }));
  if (!member) return null;
  return {
    userID: session.user.id,
    email: session.user.email,
    org,
    role: member.role,
    ssoOrg,
    ip: addressOf(headers, { forwarded }),
    userAgent: headers.get("user-agent"),
  };
}
