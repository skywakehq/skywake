import type { Role } from "@skywake/contract";
import { and, asc, eq, inArray } from "drizzle-orm";

import { roleFrom } from "../../auth/roles.ts";
import type { Db } from "../../db/client.ts";
import { keys } from "../../db/schema.ts";

export interface NewKeyRow {
  id: string;
  hash: Buffer;
  name: string;
  role: Role;
  namespaces: string;
  expires: Date | null;
  createdBy: string | null;
  createdByEmail: string | null;
}

export const TOUCH_MS = 60_000;

/** When a new key expires: in `days`, but never after the key that makes it. */
export function expiresIn(days: number | undefined, limit: Date | null) {
  const wanted = days === undefined ? null : new Date(Date.now() + days * 86_400_000);
  if (!limit) return wanted;
  return wanted && wanted < limit ? wanted : limit;
}

export async function create(db: Db, org: string, key: NewKeyRow) {
  await db.insert(keys).values({ ...key, org });
}

export async function list(db: Db, org: string) {
  const rows = await db.select().from(keys).where(eq(keys.org, org)).orderBy(asc(keys.created));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: roleFrom(row.role),
    namespaces: row.namespaces,
    expires: row.expires?.toISOString() ?? null,
    last_used: row.lastUsed?.toISOString() ?? null,
    created: row.created.toISOString(),
    created_by: row.createdBy,
    created_by_email: row.createdByEmail,
  }));
}

export async function remove(db: Db, org: string, id: string) {
  const removed = await db
    .delete(keys)
    .where(and(eq(keys.org, org), eq(keys.id, id)))
    .returning({ id: keys.id });
  return removed.length > 0;
}

/**
 * Deletes every key `maker` made in the organization, then the keys those
 * keys made, and so on. Returns how many went.
 */
export async function removeMadeBy(db: Db, org: string, maker: string) {
  let makers = [maker];
  let count = 0;
  while (makers.length > 0) {
    const removed = await db
      .delete(keys)
      .where(and(eq(keys.org, org), inArray(keys.createdBy, makers)))
      .returning({ id: keys.id });
    count += removed.length;
    makers = removed.map((key) => `key:${key.id}`);
  }
  return count;
}

export async function find(db: Db, id: string) {
  const [row] = await db.select().from(keys).where(eq(keys.id, id)).limit(1);
  if (!row) return null;
  return {
    org: row.org,
    hash: row.hash,
    role: roleFrom(row.role),
    namespaces: row.namespaces,
    expires: row.expires,
    lastUsed: row.lastUsed?.getTime() ?? 0,
  };
}

export async function touch(db: Db, id: string) {
  await db.update(keys).set({ lastUsed: new Date() }).where(eq(keys.id, id));
}
