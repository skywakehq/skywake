import { and, asc, eq, gt } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { branches } from "../../db/schema.ts";
import { pageSize, type Page } from "../../http/page.ts";

export interface BranchRef {
  org: string;
  namespace: string;
  name: string;
}

const where = (ref: BranchRef) =>
  and(
    eq(branches.org, ref.org),
    eq(branches.namespace, ref.namespace),
    eq(branches.name, ref.name),
  );

const shown = (row: typeof branches.$inferSelect) => ({
  name: row.name,
  forked_from: row.forkedFrom,
  protected: row.protected,
  created: row.created.toISOString(),
});

export async function add(db: Db, ref: BranchRef, from: string | null) {
  const added = await db
    .insert(branches)
    .values({ ...ref, forkedFrom: from })
    .onConflictDoNothing()
    .returning({ name: branches.name });
  return added.length > 0;
}

export async function remove(db: Db, ref: BranchRef) {
  const removed = await db.delete(branches).where(where(ref)).returning({ name: branches.name });
  return removed.length > 0;
}

export async function list(db: Db, org: string, namespace: string, { limit, after }: Page) {
  const rows = await db
    .select()
    .from(branches)
    .where(
      and(
        eq(branches.org, org),
        eq(branches.namespace, namespace),
        after === undefined ? undefined : gt(branches.name, after),
      ),
    )
    .orderBy(asc(branches.name))
    .limit(pageSize(limit));
  return rows.map(shown);
}

export async function protectedNames(db: Db, org: string, namespace: string) {
  const rows = await db
    .select({ name: branches.name })
    .from(branches)
    .where(
      and(eq(branches.org, org), eq(branches.namespace, namespace), eq(branches.protected, true)),
    );
  return rows.map((row) => row.name);
}

export async function find(db: Db, ref: BranchRef) {
  const [row] = await db.select().from(branches).where(where(ref)).limit(1);
  return row ? shown(row) : null;
}

export async function protect(db: Db, ref: BranchRef, value: boolean) {
  const changed = await db
    .update(branches)
    .set({ protected: value })
    .where(where(ref))
    .returning({ name: branches.name });
  return changed.length > 0;
}
