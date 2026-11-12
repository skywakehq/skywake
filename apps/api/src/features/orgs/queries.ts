import { eq } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { keys, orgs } from "../../db/schema.ts";
import type { NewKeyRow } from "../keys/queries.ts";

export async function create(db: Db, id: string, name: string, firstKey?: NewKeyRow) {
  return db.transaction(async (tx) => {
    const added = await tx
      .insert(orgs)
      .values({ id, name })
      .onConflictDoNothing()
      .returning({ id: orgs.id });
    if (added.length === 0) return false;
    if (firstKey) await tx.insert(keys).values({ ...firstKey, org: id });
    return true;
  });
}

/** Renames an organization. False when another one has the name, whatever its case. */
export async function rename(db: Db, id: string, name: string) {
  try {
    const renamed = await db
      .update(orgs)
      .set({ name })
      .where(eq(orgs.id, id))
      .returning({ id: orgs.id });
    return renamed.length > 0 ? "renamed" : "missing";
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "23505") return "taken";
    if ((error as { code?: string }).code === "23505") return "taken";
    throw error;
  }
}

export async function exists(db: Db, id: string) {
  const found = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, id)).limit(1);
  return found.length > 0;
}
