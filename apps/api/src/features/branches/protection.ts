import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { and, eq, gte, lt, sql } from "drizzle-orm";

import type { Namespace } from "../../auth/access.ts";
import type { Db } from "../../db/client.ts";
import { leases } from "../../db/schema.ts";
import { forbidden, HttpError } from "../../http/errors.ts";
import * as branches from "./queries.ts";

// A running write leaves a mark in the leases table. The mark is renewed while
// the write runs, and lapses if the process dies.
const MARK_TTL_MS = 30_000;
const PROTECT_WAIT_MS = 120_000;

const markPrefix = (ref: branches.BranchRef) =>
  `write ${JSON.stringify([ref.org, ref.namespace, ref.name])} `;
const marksOf = (ref: branches.BranchRef) => sql`starts_with(${leases.name}, ${markPrefix(ref)})`;
const expiresIn = (ms: number) => sql`now() + ${ms} * interval '1 millisecond'`;

/**
 * Runs `work`, given whether the branch is protected now. Once protecting it
 * answers, no write that was allowed before can still land: a write leaves its
 * mark before it reads `protected`, and `protect` sets `protected` before it
 * waits for the marks to go. Each saves before it reads, so one sees the other.
 * No database connection is held while `work` runs.
 */
export async function withProtection<T>(
  db: Db,
  ns: Namespace,
  branch: string,
  work: (isProtected: boolean) => Promise<T>,
): Promise<T> {
  const ref = { org: ns.org, namespace: ns.name, name: branch };
  const name = markPrefix(ref) + randomUUID();
  await db.insert(leases).values({ name, holder: name, expires: expiresIn(MARK_TTL_MS) });
  const renew = setInterval(() => {
    db.update(leases)
      .set({ expires: expiresIn(MARK_TTL_MS) })
      .where(eq(leases.name, name))
      .catch(() => {});
  }, MARK_TTL_MS / 3);
  try {
    const found = await branches.find(db, ref);
    return await work(found?.protected ?? false);
  } finally {
    clearInterval(renew);
    // A mark not removed lapses on its own.
    await db
      .delete(leases)
      .where(eq(leases.name, name))
      .catch(() => {});
  }
}

/** Runs `work` unless the branch is protected. */
export function whileWritable<T>(db: Db, ns: Namespace, branch: string, work: () => Promise<T>) {
  return withProtection(db, ns, branch, (isProtected) => {
    if (isProtected) throw forbidden(`branch \`${branch}\` is protected; change it with a merge`);
    return work();
  });
}

/** Protects the branch, then waits until the writes allowed before have ended. */
export async function protect(db: Db, ref: branches.BranchRef, { pollMs = 25 } = {}) {
  if (!(await branches.protect(db, ref, true))) return false;
  await db.delete(leases).where(and(marksOf(ref), lt(leases.expires, sql`now()`)));
  const deadline = Date.now() + PROTECT_WAIT_MS;
  for (let wait = pollMs; ; wait = Math.min(wait * 2, 500)) {
    const running = await db
      .select({ name: leases.name })
      .from(leases)
      .where(and(marksOf(ref), gte(leases.expires, sql`now()`)))
      .limit(1);
    if (running.length === 0) return true;
    if (Date.now() > deadline) {
      throw new HttpError(503, "the branch is protected, but writes to it are still running");
    }
    await sleep(wait);
  }
}
