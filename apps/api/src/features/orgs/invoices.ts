import type { orgs as contract } from "@skywake/contract";
import { asc, eq } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { indexUsage } from "../../db/schema.ts";
import {
  INDEX_METERS,
  type IndexMeter,
  METER,
  PRICE,
  rawCents,
  shown,
  shownPrice,
} from "../billing/catalog.ts";

export type Item = contract.InvoiceItem;
type Invoice = contract.Invoice;

export type Prices = Record<Item, string>;

export const PRICES = Object.fromEntries(
  INDEX_METERS.map((meter) => [meter, METER[meter].dollars]),
) as Prices;

export { PRICE };

export type UsageRow = Pick<
  typeof indexUsage.$inferSelect,
  | "index"
  | "day"
  | "embeddings"
  | "reranks"
  | "bytes"
  | "pinnedMs"
  | "bytesWritten"
  | "bytesScanned"
>;

const HOURS_PER_MONTH = 730n;
const DAY_MS = 24 * 60 * 60 * 1000;
const dayAfter = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const daysIn = (month: string) => {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
};

interface Used {
  writes: bigint;
  queries: bigint;
  embeddings: bigint;
  reranks: bigint;
  byteDays: bigint;
  byteMs: bigint;
}

const none = (): Used => ({
  writes: 0n,
  queries: 0n,
  embeddings: 0n,
  reranks: 0n,
  byteDays: 0n,
  byteMs: 0n,
});

function raw(meter: IndexMeter, used: Used, month: string) {
  if (meter === "storage") return (used.byteDays * HOURS_PER_MONTH) / BigInt(daysIn(month));
  if (meter === "pinned") return used.byteMs / 1000n;
  return used[meter];
}

export function invoices(rows: UsageRow[], prices: Prices, today: string): Invoice[] {
  const months = new Map<string, Map<string, Used>>();
  const usedIn = (month: string, index: string) => {
    let indexes = months.get(month);
    if (!indexes) months.set(month, (indexes = new Map()));
    let used = indexes.get(index);
    if (!used) indexes.set(index, (used = none()));
    return used;
  };

  for (const [index, days] of Map.groupBy(rows, (row) => row.index)) {
    days.sort((a, b) => (a.day < b.day ? -1 : 1));
    const byDay = new Map(days.map((row) => [row.day, row]));
    let size = 0n;
    for (let day = days[0]!.day; day <= today; day = dayAfter(day)) {
      const row = byDay.get(day);
      const used = usedIn(day.slice(0, 7), index);
      if (row) {
        used.writes += BigInt(row.bytesWritten);
        used.queries += BigInt(row.bytesScanned);
        used.embeddings += BigInt(row.embeddings);
        used.reranks += BigInt(row.reranks);
      }
      if (row?.bytes != null) size = BigInt(row.bytes);
      used.byteDays += size;
      used.byteMs += size * BigInt(row?.pinnedMs ?? 0);
    }
  }

  return [...months.keys()]
    .sort()
    .reverse()
    .map((month) => {
      const lines: Invoice["lines"] = [];
      const indexes = [...months.get(month)!].sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [index, used] of indexes) {
        for (const item of INDEX_METERS) {
          const amount = raw(item, used, month);
          if (amount === 0n) continue;
          lines.push({
            index,
            item,
            quantity: shown(item, amount),
            unit_price: shownPrice(item, prices[item]),
            amount_cents: rawCents(item, amount, prices[item]),
          });
        }
      }
      return {
        month,
        status: month === today.slice(0, 7) ? "open" : "closed",
        currency: "usd",
        total_cents: lines.reduce((sum, { amount_cents }) => sum + amount_cents, 0),
        lines,
      };
    });
}

export async function usageOf(db: Db, org: string): Promise<UsageRow[]> {
  return db
    .select({
      index: indexUsage.index,
      day: indexUsage.day,
      embeddings: indexUsage.embeddings,
      reranks: indexUsage.reranks,
      bytes: indexUsage.bytes,
      pinnedMs: indexUsage.pinnedMs,
      bytesWritten: indexUsage.bytesWritten,
      bytesScanned: indexUsage.bytesScanned,
    })
    .from(indexUsage)
    .where(eq(indexUsage.org, org))
    .orderBy(asc(indexUsage.index), asc(indexUsage.day));
}
