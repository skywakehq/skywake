import "server-only";

import { auth } from "./auth";
import { skywakeJSON } from "./api";

const FIRST_ENV = "prod";

const taken = (error: unknown) =>
  (error as { body?: { code?: string } })?.body?.code === "ORGANIZATION_NAME_TAKEN";

/**
 * An organization with an empty prod to put disks in. By default it is named
 * for the person's email, as "Name 2", "Name 3" and so on when that is taken.
 */
export async function newOrg(headers: Headers, user: { id: string; email: string }, name?: string) {
  const fallback = `${user.email.split("@")[0]}'s org`;
  const base =
    (name ?? fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "org";
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  let org;
  for (let n = 1; !org; n++) {
    const tried = name ?? (n === 1 ? fallback : `${fallback} ${n}`);
    try {
      org = await auth.api.createOrganization({ headers, body: { name: tried, slug } });
    } catch (error) {
      // A name someone chose stays theirs to change; only the default moves on.
      if (name !== undefined || !taken(error) || n >= 50) throw error;
    }
    if (org === null) throw new Error("Could not make an organization");
  }
  const caller = {
    userID: user.id,
    email: user.email,
    org: org.id,
    role: "owner",
    ssoOrg: null,
    ip: null,
    userAgent: null,
  };
  await skywakeJSON(caller, "/environments", "POST", { name: FIRST_ENV });
  return org.id;
}
