import { and, asc, count, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import {
  billingAccounts,
  billingReports,
  billingUsage,
  filesystemSizes,
  indexes,
  indexUsage,
  leases,
  namespaces,
  orgs,
} from "../../db/schema.ts";
import type { Meter } from "./catalog.ts";
import type { Account } from "./standing.ts";

export type AccountRow = typeof billingAccounts.$inferSelect;
type AccountChange = Partial<Omit<typeof billingAccounts.$inferInsert, "org">>;

const asAccount = (row: AccountRow): Account => ({
  org: row.org,
  customer: row.customer,
  subscription: row.subscription,
  plan: row.plan,
  nextPlan: row.nextPlan,
  status: row.status,
  startedAt: row.startedAt,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  endedAt: row.endedAt,
  pastDueSince: row.pastDueSince,
  override: row.override,
});

export async function account(db: Db, org: string) {
  const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.org, org));
  return row ? asAccount(row) : null;
}

export async function accountByCustomer(db: Db, customer: string) {
  const [row] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.customer, customer));
  return row ? asAccount(row) : null;
}

export async function subscribed(db: Db) {
  const rows = await db
    .select()
    .from(billingAccounts)
    .where(isNotNull(billingAccounts.subscription))
    .orderBy(asc(billingAccounts.org));
  return rows.map(asAccount);
}

export async function change(db: Db, org: string, values: AccountChange) {
  await db
    .insert(billingAccounts)
    .values({ org, ...values, updated: new Date() })
    .onConflictDoUpdate({ target: billingAccounts.org, set: { ...values, updated: new Date() } });
}

export async function claimCustomer(db: Db, org: string, customer: string) {
  await db.insert(billingAccounts).values({ org }).onConflictDoNothing();
  const [row] = await db
    .update(billingAccounts)
    .set({ customer, updated: new Date() })
    .where(and(eq(billingAccounts.org, org), sql`${billingAccounts.customer} is null`))
    .returning({ customer: billingAccounts.customer });
  return row?.customer ?? (await account(db, org))!.customer!;
}

export async function addUsage(
  db: Db,
  rows: { org: string; meter: Meter; hour: Date; amount: bigint }[],
) {
  if (rows.length === 0) return;
  await db
    .insert(billingUsage)
    .values(rows)
    .onConflictDoUpdate({
      target: [billingUsage.org, billingUsage.meter, billingUsage.hour],
      set: { amount: sql`${billingUsage.amount} + excluded.amount` },
    });
}

export async function setUsage(
  db: Db,
  rows: { org: string; meter: Meter; hour: Date; amount: bigint }[],
) {
  if (rows.length === 0) return;
  await db
    .insert(billingUsage)
    .values(rows)
    .onConflictDoUpdate({
      target: [billingUsage.org, billingUsage.meter, billingUsage.hour],
      set: { amount: sql`excluded.amount` },
    });
}

export async function usageSince(db: Db, org: string, from: Date) {
  const rows = await db
    .select({ meter: billingUsage.meter, amount: sql<string>`sum(${billingUsage.amount})` })
    .from(billingUsage)
    .where(and(eq(billingUsage.org, org), gte(billingUsage.hour, from)))
    .groupBy(billingUsage.meter);
  return new Map(rows.map((row) => [row.meter as Meter, BigInt(row.amount)]));
}

export async function hourly(db: Db, org: string, meter: Meter, from: Date, until: Date) {
  const rows = await db
    .select({ hour: billingUsage.hour, amount: billingUsage.amount })
    .from(billingUsage)
    .where(
      and(
        eq(billingUsage.org, org),
        eq(billingUsage.meter, meter),
        gte(billingUsage.hour, from),
        lt(billingUsage.hour, until),
      ),
    );
  return new Map(rows.map((row) => [row.hour.getTime(), row.amount]));
}

export async function cursor(db: Db, org: string, meter: Meter) {
  const [row] = await db
    .select()
    .from(billingReports)
    .where(and(eq(billingReports.org, org), eq(billingReports.meter, meter)));
  return row ?? null;
}

export async function moveCursor(
  db: Db,
  row: { org: string; meter: Meter; subscription: string; next: Date; remainder: bigint },
) {
  await db
    .insert(billingReports)
    .values(row)
    .onConflictDoUpdate({
      target: [billingReports.org, billingReports.meter],
      set: { subscription: row.subscription, next: row.next, remainder: row.remainder },
    });
}

export async function storedBytes(db: Db, org: string) {
  const latest = db
    .selectDistinctOn([indexUsage.index], { bytes: indexUsage.bytes })
    .from(indexUsage)
    .where(and(eq(indexUsage.org, org), isNotNull(indexUsage.bytes)))
    .orderBy(asc(indexUsage.index), sql`${indexUsage.day} desc`)
    .as("latest");
  const [row] = await db.select({ bytes: sql<string | null>`sum(${latest.bytes})` }).from(latest);
  return BigInt(row?.bytes ?? 0);
}

export async function indexCount(db: Db, org: string) {
  const [row] = await db.select({ n: count() }).from(indexes).where(eq(indexes.org, org));
  return BigInt(row?.n ?? 0);
}

export async function allIndexes(db: Db) {
  return db.select().from(indexes).orderBy(asc(indexes.org), asc(indexes.name));
}

export async function tryLease(db: Db, name: string, holder: string, ttlMs: number) {
  const expires = sql`now() + ${ttlMs} * interval '1 millisecond'`;
  const taken = await db
    .insert(leases)
    .values({ name, holder, expires })
    .onConflictDoUpdate({
      target: leases.name,
      set: { holder, expires },
      setWhere: or(sql`${leases.expires} < now()`, eq(leases.holder, holder)),
    })
    .returning({ holder: leases.holder });
  return taken.length > 0;
}

export async function dropLease(db: Db, name: string, holder: string) {
  await db.delete(leases).where(and(eq(leases.name, name), eq(leases.holder, holder)));
}

export async function orgName(db: Db, org: string) {
  const [row] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, org));
  return row?.name ?? null;
}

export async function allFilesystems(db: Db) {
  return db
    .select({
      org: namespaces.org,
      folder: namespaces.folder,
      region: namespaces.region,
      bytes: filesystemSizes.bytes,
      measured: filesystemSizes.measured,
      stale: filesystemSizes.stale,
    })
    .from(namespaces)
    .leftJoin(filesystemSizes, eq(filesystemSizes.folder, namespaces.folder))
    .orderBy(asc(namespaces.org), asc(namespaces.folder));
}

export async function saveSize(
  db: Db,
  size: { folder: string; org: string; bytes: bigint; objects: number; measured: Date },
) {
  await db
    .insert(filesystemSizes)
    .values({ ...size, stale: false })
    .onConflictDoUpdate({
      target: filesystemSizes.folder,
      set: { bytes: size.bytes, objects: size.objects, measured: size.measured, stale: false },
    });
}

export async function markStale(db: Db, folder: string) {
  await db
    .update(filesystemSizes)
    .set({ stale: true })
    // A row already stale is left alone, so busy writers don't queue on its lock.
    .where(and(eq(filesystemSizes.folder, folder), eq(filesystemSizes.stale, false)));
}

export async function filesStored(db: Db, org: string) {
  const [row] = await db
    .select({ bytes: sql<string | null>`sum(${filesystemSizes.bytes})` })
    .from(filesystemSizes)
    .where(eq(filesystemSizes.org, org));
  return BigInt(row?.bytes ?? 0);
}

export async function filesystemCount(db: Db, org: string) {
  const [row] = await db.select({ n: count() }).from(namespaces).where(eq(namespaces.org, org));
  return BigInt(row?.n ?? 0);
}
