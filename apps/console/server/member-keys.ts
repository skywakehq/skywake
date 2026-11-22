import { APIError } from "better-auth/api";

type Send = typeof fetch;

/**
 * Revokes every API key a person made in an organization, and the keys those
 * keys made, through the API's admin route. Called when they leave or are
 * removed, so no key outlives their place in the organization.
 */
export async function revokeKeysOf(
  org: string,
  user: string,
  send: Send = fetch,
  why = "They left the organization",
) {
  const url = `${process.env.SKYWAKE_API_URL}/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(user)}/keys`;
  const response = await send(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${process.env.SKYWAKE_API_ADMIN_TOKEN}` },
  }).catch(() => null);
  if (!response?.ok) {
    // They are out of the organization already; say their keys still work.
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message: `${why}, but their API keys could not be revoked. Delete them under API keys.`,
    });
  }
}

type AfterHook = {
  path: string;
  body?: unknown;
  context: { returned?: unknown; session?: { user: { id: string } } | null };
};

/** Who left an organization in this auth call, if anyone did. */
export function leaverOf(ctx: AfterHook) {
  if (ctx.path !== "/organization/leave" || ctx.context.returned instanceof APIError) return null;
  const org = (ctx.body as { organizationId?: unknown } | undefined)?.organizationId;
  const user = ctx.context.session?.user.id;
  return typeof org === "string" && user ? { org, user } : null;
}

// What each role may do through the API: owners and admins administer, members write.
const RANK: Record<string, number> = { owner: 2, admin: 2, member: 1 };
const rankOf = (role: string) =>
  Math.max(0, ...role.split(",").map((one) => RANK[one.trim()] ?? 0));

/**
 * Whether a role change takes away power. The keys a person made carry the role
 * they had then, so they go when the person is given less.
 */
export const demoted = (previous: string, next: string) => rankOf(next) < rankOf(previous);
