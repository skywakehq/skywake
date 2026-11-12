import type { Visibility } from "@skywake/contract";
import { and, asc, eq } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { namespaces } from "../../db/schema.ts";

export type NamespaceRow = typeof namespaces.$inferSelect;

export const shown = (row: NamespaceRow) => ({
  name: row.name,
  region: row.region,
  visibility: row.visibility as Visibility,
  created: row.created.toISOString(),
});

export async function create(db: Db, row: typeof namespaces.$inferInsert) {
  const added = await db
    .insert(namespaces)
    .values(row)
    .onConflictDoNothing()
    .returning({ name: namespaces.name });
  return added.length > 0;
}

export async function list(db: Db, org: string) {
  return db.select().from(namespaces).where(eq(namespaces.org, org)).orderBy(asc(namespaces.name));
}

export async function find(db: Db, org: string, name: string) {
  const [row] = await db
    .select()
    .from(namespaces)
    .where(and(eq(namespaces.org, org), eq(namespaces.name, name)))
    .limit(1);
  return row ?? null;
}

export async function setVisibility(db: Db, org: string, name: string, visibility: Visibility) {
  const changed = await db
    .update(namespaces)
    .set({ visibility })
    .where(and(eq(namespaces.org, org), eq(namespaces.name, name)))
    .returning({ name: namespaces.name });
  return changed.length > 0;
}
