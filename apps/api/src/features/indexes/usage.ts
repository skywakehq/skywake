import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { indexUsage } from "../../db/schema.ts";
import type { Meter } from "../billing/catalog.ts";

export interface Metering {
  record(org: string, meter: Meter, amount: bigint): void;
  admit(org: string, meter: Meter): Promise<void>;
}

const COUNTERS = ["queries", "writes", "deletes", "embeddings", "reranks"] as const;
type Counter = (typeof COUNTERS)[number];
type Counts = Record<Counter, number>;

interface Day extends Counts {
  org: string;
  index: string;
  day: string;
  rows: number | null;
  bytes: number | null;
  pinnedMs: number;
  bytesWritten: number;
  bytesScanned: number;
}

const counted = (of: (counter: Counter) => number) =>
  Object.fromEntries(COUNTERS.map((counter) => [counter, of(counter)])) as Counts;

export class Bill {
  readonly counts: Partial<Record<Counter, number>> = {};
  readonly #usage: IndexUsage;
  readonly #org: string;
  readonly #index: string;
  readonly #pinned: boolean;

  constructor(usage: IndexUsage, org: string, index: string, pinned: boolean) {
    this.#usage = usage;
    this.#org = org;
    this.#index = index;
    this.#pinned = pinned;
  }

  async admit(meter: Meter) {
    if (this.#pinned && meter === "queries") return;
    await this.#usage.admit(this.#org, meter);
  }

  count(counter: Counter, n = 1) {
    if (n === 0 || (this.#pinned && counter === "queries")) return;
    this.#usage.count(this.#org, this.#index, counter, n);
    this.counts[counter] = (this.counts[counter] ?? 0) + n;
  }

  wrote(bytes: number) {
    this.#usage.wrote(this.#org, this.#index, bytes);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FLUSH_MS = 5000;
const SIZE_MS = 10 * 60 * 1000;

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

const sizeKey = (org: string, index: string) => `${org}\0${index}`;

export class IndexUsage {
  readonly #db: Db;
  readonly #metering: Metering | null;
  #pending = new Map<string, Day>();
  #timer: NodeJS.Timeout | null = null;
  readonly #sizes = new Map<string, { at: number; bytes: Promise<number> }>();

  constructor(db: Db, metering: Metering | null = null) {
    this.#db = db;
    this.#metering = metering;
  }

  admit(org: string, meter: Meter) {
    return this.#metering?.admit(org, meter) ?? Promise.resolve();
  }

  wrote(org: string, index: string, bytes: number) {
    if (bytes <= 0) return;
    this.#day(org, index).bytesWritten += bytes;
    this.#metering?.record(org, "writes", BigInt(bytes));
  }

  bill(index: { org: string; name: string; pinnedReplicas: number | null }) {
    return new Bill(this, index.org, index.name, index.pinnedReplicas !== null);
  }

  count(org: string, index: string, counter: Counter, n = 1) {
    this.#day(org, index)[counter] += n;
    if (counter === "queries") void this.#scanned(org, index, n);
    if (counter === "embeddings" || counter === "reranks") {
      this.#metering?.record(org, counter, BigInt(n));
    }
  }

  /** Time one replica of the index was held. */
  pinned(org: string, index: string, ms: number) {
    this.#day(org, index).pinnedMs += Math.round(ms);
    if (!this.#metering) return;
    void this.#sizeOf(org, index).then((bytes) =>
      this.#metering!.record(org, "pinned", (BigInt(bytes) * BigInt(Math.round(ms))) / 1000n),
    );
  }

  async #scanned(org: string, index: string, queries: number) {
    const bytes = (await this.#sizeOf(org, index)) * queries;
    if (bytes <= 0) return;
    this.#day(org, index).bytesScanned += bytes;
    this.#metering?.record(org, "queries", BigInt(bytes));
  }

  #sizeOf(org: string, index: string) {
    const key = sizeKey(org, index);
    const found = this.#sizes.get(key);
    if (found && performance.now() - found.at < SIZE_MS) return found.bytes;
    const bytes = this.#latestBytes(org, index).catch(() => 0);
    this.#sizes.set(key, { at: performance.now(), bytes });
    return bytes;
  }

  async #latestBytes(org: string, index: string) {
    const [row] = await this.#db
      .select({ bytes: indexUsage.bytes })
      .from(indexUsage)
      .where(and(eq(indexUsage.org, org), eq(indexUsage.index, index), isNotNull(indexUsage.bytes)))
      .orderBy(desc(indexUsage.day))
      .limit(1);
    return row?.bytes ?? 0;
  }

  /** The size of `main` as just counted. */
  sized(org: string, index: string, stats: { rows: number; bytes: number } | null) {
    if (!stats) return;
    const day = this.#day(org, index);
    day.rows = stats.rows;
    day.bytes = stats.bytes;
    this.#sizes.set(sizeKey(org, index), {
      at: performance.now(),
      bytes: Promise.resolve(stats.bytes),
    });
  }

  #day(org: string, index: string) {
    const day = today();
    const key = JSON.stringify([org, index, day]);
    let found = this.#pending.get(key);
    if (!found) {
      found = {
        org,
        index,
        day,
        ...counted(() => 0),
        rows: null,
        bytes: null,
        pinnedMs: 0,
        bytesWritten: 0,
        bytesScanned: 0,
      };
      this.#pending.set(key, found);
    }
    this.#timer ??= setTimeout(() => void this.flush().catch(() => {}), FLUSH_MS).unref();
    return found;
  }

  async flush() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const days = [...this.#pending.values()];
    this.#pending = new Map();
    for (const day of days) {
      await this.#db
        .insert(indexUsage)
        .values(day)
        .onConflictDoUpdate({
          target: [indexUsage.org, indexUsage.index, indexUsage.day],
          set: {
            ...Object.fromEntries(
              COUNTERS.map((n) => [n, sql`${indexUsage[n]} + excluded.${sql.raw(n)}`]),
            ),
            pinnedMs: sql`${indexUsage.pinnedMs} + excluded.pinned_ms`,
            bytesWritten: sql`${indexUsage.bytesWritten} + excluded.bytes_written`,
            bytesScanned: sql`${indexUsage.bytesScanned} + excluded.bytes_scanned`,
            rows: sql`coalesce(excluded.rows, ${indexUsage.rows})`,
            bytes: sql`coalesce(excluded.bytes, ${indexUsage.bytes})`,
          },
        })
        .catch(() => {});
    }
  }

  async read(org: string, index: string, days: number) {
    await this.flush();
    const now = Date.now();
    const first = today(now - (days - 1) * DAY_MS);
    const rows = await this.#db
      .select()
      .from(indexUsage)
      .where(and(eq(indexUsage.org, org), eq(indexUsage.index, index), gte(indexUsage.day, first)))
      .orderBy(asc(indexUsage.day));
    const byDay = new Map(rows.map((row) => [row.day, row]));
    return Array.from({ length: days }, (_, i) => {
      const day = today(now - (days - 1 - i) * DAY_MS);
      const row = byDay.get(day);
      return {
        day,
        ...counted((counter) => row?.[counter] ?? 0),
        rows: row?.rows ?? null,
        bytes: row?.bytes ?? null,
      };
    });
  }
}
