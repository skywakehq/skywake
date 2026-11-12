import { inArray, lt, sql } from "drizzle-orm";

import type { Db } from "../db/client.ts";
import { audit } from "../db/schema.ts";
import type { Sink } from "./recorder.ts";

export const postgresSink =
  (db: Db): Sink =>
  async (events) => {
    await db.insert(audit).values(events);
  };

const PRUNE_BATCH = 10_000;

export async function prune(db: Db, days: number) {
  const before = sql`now() - ${days} * interval '1 day'`;
  let total = 0;
  for (;;) {
    const old = db
      .select({ id: audit.id })
      .from(audit)
      .where(lt(audit.at, before))
      .limit(PRUNE_BATCH);
    const gone = await db.delete(audit).where(inArray(audit.id, old)).returning({ id: audit.id });
    total += gone.length;
    if (gone.length < PRUNE_BATCH) return total;
  }
}
