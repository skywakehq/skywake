import { and, desc, eq, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { indexLinkBranches, indexLinks, indexStamps } from "../../db/schema.ts";

export type Link = typeof indexLinks.$inferSelect;
export type LinkedBranchRow = typeof indexLinkBranches.$inferSelect;

/** How long a save waits, so a burst of saves is indexed once. */
export const SAVE_DELAY_MS = 30_000;
/** How often a linked branch's head is read even when nothing said it moved. */
export const CHECK_EVERY_MS = 5 * 60_000;
/** How long a claim lasts before another server may take the branch. */
export const CLAIM_MS = 60_000;
/** Branches of one organization synced at once, across all servers. */
export const PER_ORG = 4;

export async function find(db: Db, org: string, namespace: string) {
  const [row] = await db
    .select()
    .from(indexLinks)
    .where(and(eq(indexLinks.org, org), eq(indexLinks.namespace, namespace)));
  return row ?? null;
}

export async function save(db: Db, link: typeof indexLinks.$inferInsert) {
  await db
    .insert(indexLinks)
    .values(link)
    .onConflictDoUpdate({
      target: [indexLinks.org, indexLinks.namespace],
      set: {
        index: link.index,
        include: link.include,
        exclude: link.exclude,
        maxBytes: link.maxBytes,
      },
    });
}

export async function remove(db: Db, org: string, namespace: string) {
  await db
    .delete(indexLinks)
    .where(and(eq(indexLinks.org, org), eq(indexLinks.namespace, namespace)));
}

export async function branches(db: Db, org: string, namespace: string) {
  return db
    .select()
    .from(indexLinkBranches)
    .where(and(eq(indexLinkBranches.org, org), eq(indexLinkBranches.namespace, namespace)))
    .orderBy(indexLinkBranches.branch);
}

export async function branch(db: Db, org: string, namespace: string, name: string) {
  const [row] = await db
    .select()
    .from(indexLinkBranches)
    .where(
      and(
        eq(indexLinkBranches.org, org),
        eq(indexLinkBranches.namespace, namespace),
        eq(indexLinkBranches.branch, name),
      ),
    );
  return row ?? null;
}

/** Links a branch, matching `synced` already (a fork) or nothing yet (indexed in full). */
export async function addBranch(
  db: Db,
  org: string,
  namespace: string,
  name: string,
  synced: string | null,
) {
  await db
    .insert(indexLinkBranches)
    .values({ org, namespace, branch: name, synced, dirty: true, due: new Date() })
    .onConflictDoNothing();
}

export async function removeBranch(db: Db, org: string, namespace: string, name: string) {
  await db
    .delete(indexLinkBranches)
    .where(
      and(
        eq(indexLinkBranches.org, org),
        eq(indexLinkBranches.namespace, namespace),
        eq(indexLinkBranches.branch, name),
      ),
    );
}

/** Indexes every linked branch of a namespace again, in full. */
export async function reindex(db: Db, org: string, namespace: string) {
  await db
    .update(indexLinkBranches)
    .set({ synced: null, dirty: true, due: sql`now()` })
    .where(and(eq(indexLinkBranches.org, org), eq(indexLinkBranches.namespace, namespace)));
}

/**
 * Notes that a branch moved. Only flips a clean row, so a branch saving every
 * two seconds costs one row update per sync, not one per save. A commit (`now`)
 * pulls an already-due time forward; a save never pushes one back.
 */
export async function moved(
  db: Db,
  org: string,
  namespace: string,
  name: string,
  now: boolean,
): Promise<void> {
  const due = now ? sql`now()` : sql`now() + ${`${SAVE_DELAY_MS} milliseconds`}::interval`;
  await db
    .update(indexLinkBranches)
    .set({ dirty: true, due: sql`CASE WHEN ${indexLinkBranches.dirty} THEN least(${indexLinkBranches.due}, ${due}) ELSE ${due} END` })
    .where(
      and(
        eq(indexLinkBranches.org, org),
        eq(indexLinkBranches.namespace, namespace),
        eq(indexLinkBranches.branch, name),
        now
          ? sql`(NOT ${indexLinkBranches.dirty} OR ${indexLinkBranches.due} > now())`
          : sql`NOT ${indexLinkBranches.dirty}`,
      ),
    );
}

/**
 * Claims up to `limit` branches that are due: dirty and past their delay, or
 * unchecked for `CHECK_EVERY_MS` (so a save nobody told the API about is still
 * found). Rows other servers hold are skipped, not waited on, and an
 * organization never has more than `PER_ORG` branches syncing at once.
 *
 * The claim clears `dirty`, so a save that lands while the sync runs marks the
 * branch again and it is synced once more after.
 */
export async function claim(db: Db, server: string, limit: number): Promise<LinkedBranchRow[]> {
  // Candidates skip organizations already at their cap, so one with thousands
  // of due branches can't fill the window; the rank then keeps a single claim
  // from taking more than the cap of one. Two servers claiming at the same
  // instant may each fill an organization's last places, so the cap is held
  // to within a claim's worth, not exactly.
  const result = await db.execute<Record<string, unknown>>(sql`
    WITH held AS (
      SELECT org, count(*) AS n FROM api.index_link_branches
      WHERE claimed_until > now()
      GROUP BY org
    ), candidates AS (
      SELECT org, namespace, branch, due FROM api.index_link_branches
      WHERE (claimed_until IS NULL OR claimed_until < now())
        AND ((dirty AND due <= now())
          OR checked < now() - ${`${CHECK_EVERY_MS} milliseconds`}::interval)
        AND org NOT IN (SELECT org FROM held WHERE n >= ${PER_ORG})
      ORDER BY due
      LIMIT ${limit * 4}
      FOR UPDATE SKIP LOCKED
    ), picked AS (
      SELECT ranked.org, ranked.namespace, ranked.branch FROM (
        SELECT c.*, row_number() OVER (PARTITION BY c.org ORDER BY c.due) AS rank
        FROM candidates c
      ) ranked
      LEFT JOIN held ON held.org = ranked.org
      WHERE ranked.rank + coalesce(held.n, 0) <= ${PER_ORG}
      ORDER BY ranked.due
      LIMIT ${limit}
    )
    UPDATE api.index_link_branches AS b
    SET claimed_by = ${server},
        claimed_until = now() + ${`${CLAIM_MS} milliseconds`}::interval,
        dirty = false
    FROM picked
    WHERE b.org = picked.org AND b.namespace = picked.namespace AND b.branch = picked.branch
    RETURNING b.*`);
  return result.rows.map((row) => ({
    org: row.org as string,
    namespace: row.namespace as string,
    branch: row.branch as string,
    synced: (row.synced as string | null) ?? null,
    dirty: row.dirty as boolean,
    due: new Date(row.due as string),
    checked: new Date(row.checked as string),
    claimedBy: row.claimed_by as string,
    claimedUntil: new Date(row.claimed_until as string),
    attempts: row.attempts as number,
    error: (row.error as string | null) ?? null,
    syncedAt: row.synced_at ? new Date(row.synced_at as string) : null,
  }));
}

/** Keeps a claim while the sync runs. False once another server took it. */
export async function renew(db: Db, row: LinkedBranchRow, server: string) {
  const renewed = await db
    .update(indexLinkBranches)
    .set({ claimedUntil: sql`now() + ${`${CLAIM_MS} milliseconds`}::interval` })
    .where(and(...key(row), eq(indexLinkBranches.claimedBy, server)))
    .returning({ branch: indexLinkBranches.branch });
  return renewed.length > 0;
}

/** The branch's index now matches `head`. A save since the claim left it dirty. */
export async function synced(db: Db, row: LinkedBranchRow, server: string, head: string) {
  await db
    .update(indexLinkBranches)
    .set({
      synced: head,
      checked: sql`now()`,
      claimedBy: null,
      claimedUntil: null,
      attempts: 0,
      error: null,
      syncedAt: sql`now()`,
    })
    .where(and(...key(row), eq(indexLinkBranches.claimedBy, server)));
}

/** The try failed: keep it dirty and try later, longer each time, up to an hour. */
export async function failed(db: Db, row: LinkedBranchRow, server: string, error: string) {
  const wait = Math.min(60 * 60_000, 15_000 * 2 ** Math.min(row.attempts, 12));
  await db
    .update(indexLinkBranches)
    .set({
      dirty: true,
      due: sql`now() + ${`${wait} milliseconds`}::interval`,
      checked: sql`now()`,
      claimedBy: null,
      claimedUntil: null,
      attempts: sql`${indexLinkBranches.attempts} + 1`,
      error: error.slice(0, 1000),
    })
    .where(and(...key(row), eq(indexLinkBranches.claimedBy, server)));
}

function key(row: Pick<LinkedBranchRow, "org" | "namespace" | "branch">) {
  return [
    eq(indexLinkBranches.org, row.org),
    eq(indexLinkBranches.namespace, row.namespace),
    eq(indexLinkBranches.branch, row.branch),
  ];
}

export async function stamp(
  db: Db,
  org: string,
  index: string,
  branch: string,
  commit: string,
  version: string,
) {
  await db
    .insert(indexStamps)
    .values({ org, index, branch, commit, version })
    .onConflictDoUpdate({
      target: [indexStamps.org, indexStamps.index, indexStamps.branch, indexStamps.commit],
      set: { version, at: sql`now()` },
    });
}

/** The newest stamps of an index branch, newest first. */
export async function stamps(db: Db, org: string, index: string, branch: string, limit = 32) {
  return db
    .select()
    .from(indexStamps)
    .where(
      and(eq(indexStamps.org, org), eq(indexStamps.index, index), eq(indexStamps.branch, branch)),
    )
    .orderBy(desc(indexStamps.at))
    .limit(limit);
}

export async function stampOf(
  db: Db,
  org: string,
  index: string,
  branch: string,
  commit: string,
) {
  const [row] = await db
    .select()
    .from(indexStamps)
    .where(
      and(
        eq(indexStamps.org, org),
        eq(indexStamps.index, index),
        eq(indexStamps.branch, branch),
        eq(indexStamps.commit, commit),
      ),
    );
  return row ?? null;
}

/** Drops stamps older than the index keeps versions, so the table stays small. */
export async function pruneStamps(db: Db, keepDays: number) {
  await db.execute(
    sql`DELETE FROM api.index_stamps WHERE at < now() - ${`${keepDays} days`}::interval`,
  );
}
