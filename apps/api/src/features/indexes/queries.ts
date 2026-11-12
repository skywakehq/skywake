import { and, asc, eq, gt, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { indexBranches, indexOperations, indexes } from "../../db/schema.ts";
import { pageSize, type Page } from "../../http/page.ts";

export type IndexRow = typeof indexes.$inferSelect;

export interface IndexBranchRef {
  org: string;
  index: string;
  name: string;
}

export const shown = (row: IndexRow) => ({
  name: row.name,
  region: row.region,
  schema: row.schema,
  shards: row.shards,
  encryption: row.kmsKeyId === null ? null : { kms_key_id: row.kmsKeyId },
  read_only: row.readOnly,
  retention_days: row.retentionDays,
  pinned: row.pinnedReplicas === null ? null : { replicas: row.pinnedReplicas },
  created: row.created.toISOString(),
});

export const openOptions = (row: Pick<IndexRow, "shards" | "kmsKeyId">) => ({
  shards: row.shards,
  kmsKeyId: row.kmsKeyId ?? undefined,
});

export async function create(db: Db, row: typeof indexes.$inferInsert) {
  const added = await db
    .insert(indexes)
    .values(row)
    .onConflictDoNothing()
    .returning({ name: indexes.name });
  return added.length > 0;
}

export async function list(db: Db, org: string) {
  return db.select().from(indexes).where(eq(indexes.org, org)).orderBy(asc(indexes.name));
}

export async function find(db: Db, org: string, name: string) {
  const [row] = await db
    .select()
    .from(indexes)
    .where(and(eq(indexes.org, org), eq(indexes.name, name)))
    .limit(1);
  return row ?? null;
}

export async function setSchema(db: Db, row: IndexRow, schema: IndexRow["schema"]) {
  const set = await db
    .update(indexes)
    .set({ schema })
    .where(
      and(
        eq(indexes.org, row.org),
        eq(indexes.name, row.name),
        sql`${indexes.schema} = ${JSON.stringify(row.schema)}::jsonb`,
      ),
    )
    .returning({ name: indexes.name });
  return set.length > 0;
}

export async function setReadOnly(db: Db, org: string, name: string, readOnly: boolean) {
  await db
    .update(indexes)
    .set({ readOnly })
    .where(and(eq(indexes.org, org), eq(indexes.name, name)));
}

export async function setRetention(db: Db, org: string, name: string, days: number | null) {
  await db
    .update(indexes)
    .set({ retentionDays: days })
    .where(and(eq(indexes.org, org), eq(indexes.name, name)));
}

export async function setPinned(db: Db, org: string, name: string, replicas: number | null) {
  await db
    .update(indexes)
    .set({ pinnedReplicas: replicas })
    .where(and(eq(indexes.org, org), eq(indexes.name, name)));
}

export async function remove(db: Db, org: string, name: string) {
  const removed = await db
    .delete(indexes)
    .where(and(eq(indexes.org, org), eq(indexes.name, name)))
    .returning({ name: indexes.name });
  return removed.length > 0;
}

const whereBranch = (ref: IndexBranchRef) =>
  and(
    eq(indexBranches.org, ref.org),
    eq(indexBranches.index, ref.index),
    eq(indexBranches.name, ref.name),
  );

const shownBranch = (row: typeof indexBranches.$inferSelect) => ({
  name: row.name,
  forked_from: row.forkedFrom,
  created: row.created.toISOString(),
});

export async function addBranch(db: Db, ref: IndexBranchRef, from: string | null) {
  const added = await db
    .insert(indexBranches)
    .values({ ...ref, forkedFrom: from })
    .onConflictDoNothing()
    .returning({ name: indexBranches.name });
  return added.length > 0;
}

export async function removeBranch(db: Db, ref: IndexBranchRef) {
  await db.delete(indexBranches).where(whereBranch(ref));
}

export async function findBranch(db: Db, ref: IndexBranchRef) {
  const [row] = await db.select().from(indexBranches).where(whereBranch(ref)).limit(1);
  return row ? shownBranch(row) : null;
}

export async function listBranches(db: Db, org: string, index: string, { limit, after }: Page) {
  const rows = await db
    .select()
    .from(indexBranches)
    .where(
      and(
        eq(indexBranches.org, org),
        eq(indexBranches.index, index),
        after === undefined ? undefined : gt(indexBranches.name, after),
      ),
    )
    .orderBy(asc(indexBranches.name))
    .limit(pageSize(limit));
  return rows.map(shownBranch);
}

export type OperationRow = typeof indexOperations.$inferSelect;

export const shownOperation = (row: OperationRow) => ({
  id: row.id,
  index: row.index,
  branch: row.branch,
  kind: row.kind,
  status: row.status,
  error: row.error,
  started: row.started.toISOString(),
  finished: row.finished?.toISOString() ?? null,
});

export async function startOperation(db: Db, row: typeof indexOperations.$inferInsert) {
  const [made] = await db.insert(indexOperations).values(row).returning();
  return made!;
}

export async function finishOperation(db: Db, id: string, error: string | null) {
  await db
    .update(indexOperations)
    .set({ status: error === null ? "done" : "failed", error, finished: new Date() })
    .where(eq(indexOperations.id, id));
}

export async function findOperation(db: Db, org: string, index: string, id: string) {
  const [row] = await db
    .select()
    .from(indexOperations)
    .where(
      and(
        eq(indexOperations.id, id),
        eq(indexOperations.org, org),
        eq(indexOperations.index, index),
      ),
    )
    .limit(1);
  return row ?? null;
}
