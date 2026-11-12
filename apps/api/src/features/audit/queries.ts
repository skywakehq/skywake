import { and, desc, eq, gte, lt, or, type SQL } from "drizzle-orm";

import type { Outcome } from "../../audit/event.ts";
import type { Db } from "../../db/client.ts";
import { audit } from "../../db/schema.ts";

export interface Filter {
  after?: number;
  since?: Date;
  until?: Date;
  actor?: string;
  action?: string;
  outcome?: Outcome;
}

/** A page of the organization's events, newest first, with those it owns that others caused. */
export async function page(db: Db, org: string, limit: number, filter: Filter) {
  const where: (SQL | undefined)[] = [
    or(eq(audit.org, org), eq(audit.owner, org)),
    filter.after === undefined ? undefined : lt(audit.id, filter.after),
    filter.since && gte(audit.at, filter.since),
    filter.until && lt(audit.at, filter.until),
    filter.actor === undefined ? undefined : eq(audit.actor, filter.actor),
    filter.action === undefined ? undefined : eq(audit.action, filter.action),
    filter.outcome === undefined ? undefined : eq(audit.outcome, filter.outcome),
  ];
  const rows = await db
    .select()
    .from(audit)
    .where(and(...where))
    .orderBy(desc(audit.id))
    .limit(limit + 1);
  const events = rows.slice(0, limit).map((row) => ({
    ...row,
    id: String(row.id),
    at: row.at.toISOString(),
  }));
  return { events, next: rows.length > limit ? events.at(-1)!.id : null };
}
