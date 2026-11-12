import { asc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { indexes, peers } from "../../db/schema.ts";

export type PeerRow = typeof peers.$inferSelect;
export type Serving = PeerRow["serving"];

const FORGOTTEN_MS = 60 * 60 * 1000;

const ago = (ms: number) => sql`now() - ${ms} * interval '1 millisecond'`;

export async function beat(db: Db, peer: Omit<PeerRow, "seen">) {
  await db
    .insert(peers)
    .values({ ...peer, seen: sql`now()` })
    .onConflictDoUpdate({
      target: peers.id,
      set: { url: peer.url, serving: peer.serving, seen: sql`now()` },
    });
  await db.delete(peers).where(lt(peers.seen, ago(FORGOTTEN_MS)));
}

export async function live(db: Db, ms: number) {
  return db
    .select()
    .from(peers)
    .where(gt(peers.seen, ago(ms)))
    .orderBy(asc(peers.id));
}

export async function forget(db: Db, id: string) {
  await db.delete(peers).where(eq(peers.id, id));
}

export async function pinnedIndexes(db: Db) {
  return db
    .select({
      org: indexes.org,
      name: indexes.name,
      folder: indexes.folder,
      region: indexes.region,
      shards: indexes.shards,
      kmsKeyId: indexes.kmsKeyId,
      replicas: indexes.pinnedReplicas,
    })
    .from(indexes)
    .where(isNotNull(indexes.pinnedReplicas));
}

export type PinnedRow = Awaited<ReturnType<typeof pinnedIndexes>>[number];
