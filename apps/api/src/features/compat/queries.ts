import { and, eq } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { compatNamespaces as names } from "../../db/schema.ts";
import { MAIN } from "../indexes/lifecycle.ts";

export type NameRow = typeof names.$inferSelect;

export async function find(db: Db, org: string, name: string) {
  const [row] = await db
    .select()
    .from(names)
    .where(and(eq(names.org, org), eq(names.name, name)));
  return row;
}

export async function list(db: Db, org: string) {
  return db.select().from(names).where(eq(names.org, org));
}

export async function add(
  db: Db,
  row: { org: string; name: string; index: string; branch: string },
) {
  const added = await db.insert(names).values(row).onConflictDoNothing().returning();
  return added.length > 0;
}

export async function remove(db: Db, org: string, name: string) {
  await db.delete(names).where(and(eq(names.org, org), eq(names.name, name)));
}

export async function hide(db: Db, org: string, index: string) {
  await db
    .insert(names)
    .values({ org, name: index, index, branch: MAIN, hidden: true })
    .onConflictDoUpdate({ target: [names.org, names.name], set: { hidden: true } });
}

export async function branchesOf(db: Db, org: string, index: string) {
  const rows = await db
    .select()
    .from(names)
    .where(and(eq(names.org, org), eq(names.index, index)));
  return rows.filter((row) => !row.hidden);
}
