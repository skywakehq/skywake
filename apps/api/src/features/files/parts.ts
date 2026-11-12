import type { FileChunk } from "@skywake/engine";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { uploadParts } from "../../db/schema.ts";
import { onceEvery } from "../../db/throttle.ts";

// Garbage collection keeps unused chunks 8 days, longer than a part is kept.
const KEPT = sql`now() - interval '7 days'`;

const clearDue = onceEvery(60_000);

interface Ref {
  org: string;
  name: string;
}

export async function save(db: Db, ns: Ref, part: string, size: number, chunks: FileChunk[]) {
  if (clearDue()) {
    await db.delete(uploadParts).where(lt(uploadParts.createdAt, KEPT));
  }
  await db
    .insert(uploadParts)
    .values({ org: ns.org, namespace: ns.name, part, size, chunks })
    .onConflictDoUpdate({
      target: [uploadParts.org, uploadParts.namespace, uploadParts.part],
      set: { createdAt: sql`now()` },
    });
}

export async function chunks(db: Db, ns: Ref, parts: string[]) {
  if (parts.length === 0) return new Map<string, FileChunk[]>();
  const rows = await db
    .select({ part: uploadParts.part, chunks: uploadParts.chunks })
    .from(uploadParts)
    .where(
      and(
        eq(uploadParts.org, ns.org),
        eq(uploadParts.namespace, ns.name),
        inArray(uploadParts.part, [...new Set(parts)]),
        gt(uploadParts.createdAt, KEPT),
      ),
    );
  return new Map(rows.map((row) => [row.part, row.chunks]));
}
