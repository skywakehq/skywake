import "server-only";

import { auth } from "./auth";
import { skywakeJSON } from "./api";

const FIRST_ENV = "prod";

/** An organization with an empty prod to put disks in; by default named for the person's email. */
export async function newOrg(
  headers: Headers,
  user: { id: string; email: string },
  name = `${user.email.split("@")[0]}'s org`,
) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "org";
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  const org = await auth.api.createOrganization({ headers, body: { name, slug } });
  if (!org) throw new Error("Could not make an organization");
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
