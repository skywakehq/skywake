import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { deletions } from "../../db/schema.ts";

export type DeletionRow = typeof deletions.$inferSelect;

/** How long a claim lasts before another server may take the deletion. */
export const CLAIM_MS = 5 * 60_000;

/**
 * Removes a namespace's or index's row and queues its folder for deletion, in
 * one statement: a crash can't land between the two and leave the folder
 * behind. False when there was no such row.
 */
export async function removeAndDelete(
  db: Db,
  kind: "namespace" | "index",
  org: string,
  name: string,
) {
  const table = kind === "namespace" ? sql`api.namespaces` : sql`api.indexes`;
  const result = await db.execute(sql`
    WITH gone AS (
      DELETE FROM ${table} WHERE org = ${org} AND name = ${name}
      RETURNING org, name, region, folder
    )
    INSERT INTO api.deletions (org, kind, name, region, folder)
    SELECT org, ${kind}, name, region, folder FROM gone
    RETURNING id`);
  return result.rows.length > 0;
}

export async function claim(db: Db, server: string, limit: number): Promise<DeletionRow[]> {
  const result = await db.execute<Record<string, unknown>>(sql`
    UPDATE api.deletions AS d
    SET claimed_by = ${server},
        claimed_until = now() + ${`${CLAIM_MS} milliseconds`}::interval
    WHERE d.id IN (
      SELECT id FROM api.deletions
      WHERE due <= now() AND (claimed_until IS NULL OR claimed_until < now())
      ORDER BY due
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING d.*`);
  return result.rows.map((row) => ({
    id: Number(row.id),
    org: row.org as string,
    kind: row.kind as "namespace" | "index",
    name: row.name as string,
    region: row.region as string,
    folder: row.folder as string,
    due: new Date(row.due as string),
    claimedBy: row.claimed_by as string,
    claimedUntil: new Date(row.claimed_until as string),
    attempts: row.attempts as number,
    error: (row.error as string | null) ?? null,
    created: new Date(row.created as string),
  }));
}

export async function done(db: Db, row: DeletionRow, server: string) {
  await db
    .delete(deletions)
    .where(and(eq(deletions.id, row.id), eq(deletions.claimedBy, server)));
}

/** Try again later, longer each time, up to an hour. */
export async function failed(db: Db, row: DeletionRow, server: string, error: string) {
  const wait = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(row.attempts, 12));
  await db
    .update(deletions)
    .set({
      due: sql`now() + ${`${wait} milliseconds`}::interval`,
      claimedBy: null,
      claimedUntil: null,
      attempts: sql`${deletions.attempts} + 1`,
      error: error.slice(0, 1000),
    })
    .where(and(eq(deletions.id, row.id), eq(deletions.claimedBy, server)));
}

/** Whether a region still has folders waiting to be deleted. */
export async function pendingIn(db: Db, region: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deletions)
    .where(eq(deletions.region, region));
  return (row?.n ?? 0) > 0;
}
