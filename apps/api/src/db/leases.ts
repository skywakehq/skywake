import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { and, eq, sql } from "drizzle-orm";

import { jsonLog, type Log } from "../http/log.ts";
import type { Db } from "./client.ts";
import { leases } from "./schema.ts";

/**
 * Runs `work` while holding the lease `name`, so it runs one at a time across
 * every API process. No database connection is held while it runs. A lease
 * lapses after `ttlMs`, so a process that dies cannot hold it forever.
 */
export async function withLease<T>(
  db: Db,
  name: string,
  work: () => Promise<T>,
  {
    ttlMs = 60_000,
    pollMs = 25,
    log = jsonLog,
  }: { ttlMs?: number; pollMs?: number; log?: Log } = {},
): Promise<T> {
  const holder = randomUUID();
  const expires = sql`now() + ${ttlMs} * interval '1 millisecond'`;
  for (let wait = pollMs; ; wait = Math.min(wait * 2, 1000)) {
    const taken = await db
      .insert(leases)
      .values({ name, holder, expires })
      .onConflictDoUpdate({
        target: leases.name,
        set: { holder, expires },
        setWhere: sql`${leases.expires} < now()`,
      })
      .returning({ holder: leases.holder });
    if (taken.length > 0) break;
    await sleep(wait * (0.5 + Math.random()));
  }
  try {
    return await work();
  } finally {
    // The work is done either way; a lease not let go lapses on its own.
    await db
      .delete(leases)
      .where(and(eq(leases.name, name), eq(leases.holder, holder)))
      .catch((error: unknown) =>
        log({ level: "warn", msg: "lease not released", lease: name, error: String(error) }),
      );
  }
}
