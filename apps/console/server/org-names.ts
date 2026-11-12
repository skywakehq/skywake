import { randomBytes } from "node:crypto";
import { APIError } from "better-auth/api";

type Send = typeof fetch;

/**
 * Registers a new organization with the API before Better Auth makes it, and
 * returns the id both will use. The API keeps names unique whatever the case,
 * whether the console or the API made the organization, so a taken name stops
 * here and nothing is made.
 */
export async function reserveOrg(name: string, send: Send = fetch) {
  const id = randomBytes(24).toString("base64url");
  const response = await send(`${process.env.SKYWAKE_API_URL}/orgs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.SKYWAKE_API_ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id, name }),
  });
  if (response.status === 409) throw taken(name);
  if (!response.ok) throw new Error(`the API refused the organization: ${await response.text()}`);
  return id;
}

const taken = (name: string) =>
  new APIError("BAD_REQUEST", {
    code: "ORGANIZATION_NAME_TAKEN",
    message: `An organization named “${name}” exists. Pick another name.`,
  });

/**
 * Renames an organization on the API first, where names are unique, so a
 * taken name stops the rename before Better Auth makes it. If Better Auth
 * then fails, start-up gives the API the console's name again.
 */
export async function renameFirst(
  org: string,
  data: { name?: unknown; [field: string]: unknown },
  send: Send = fetch,
) {
  if (typeof data.name !== "string") return;
  const response = await send(`${process.env.SKYWAKE_API_URL}/orgs/${org}/name`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${process.env.SKYWAKE_API_ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: data.name }),
  });
  if (response.status === 409) throw taken(data.name);
  if (!response.ok) throw new Error(`the API refused the name: ${await response.text()}`);
}

type Org = { id: string; name: string };

/**
 * Gives the API each organization's name as the console shows it. Older
 * organizations were registered under their slug. When the name is taken,
 * the organization becomes "Name 2", "Name 3" and so on, on both sides.
 * Returns the organizations whose name changed here.
 */
export async function alignNames(
  orgs: Org[],
  renameHere: (org: Org) => Promise<unknown>,
  send: Send = fetch,
) {
  const changed: Org[] = [];
  for (const org of orgs) {
    for (let n = 1; n <= 100; n++) {
      const name = n === 1 ? org.name : `${org.name} ${n}`;
      const response = await send(`${process.env.SKYWAKE_API_URL}/orgs/${org.id}/name`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${process.env.SKYWAKE_API_ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      if (response.status === 409) continue;
      if (!response.ok) {
        console.error(`could not name organization ${org.id}: ${await response.text()}`);
        break;
      }
      if (name !== org.name) {
        await renameHere({ id: org.id, name });
        changed.push({ id: org.id, name });
      }
      break;
    }
  }
  return changed;
}
