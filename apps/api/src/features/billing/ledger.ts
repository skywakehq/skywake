import type { Db } from "../../db/client.ts";
import type { Log } from "../../http/log.ts";
import { messageOf } from "../../http/errors.ts";
import type { Meter } from "./catalog.ts";
import * as billing from "./queries.ts";

const HOUR_MS = 60 * 60 * 1000;
const FLUSH_MS = 5000;

export const hourOf = (at: Date) => new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);

interface Pending {
  org: string;
  meter: Meter;
  hour: Date;
  amount: bigint;
}

export class Ledger {
  readonly #db: Db;
  readonly #log: Log;
  readonly #now: () => Date;
  #pending = new Map<string, Pending>();
  #timer: NodeJS.Timeout | null = null;
  #flushing: Promise<void> = Promise.resolve();

  constructor(db: Db, log: Log, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#log = log;
    this.#now = now;
  }

  add(org: string, meter: Meter, amount: bigint) {
    if (amount <= 0n) return;
    const hour = hourOf(this.#now());
    const key = `${org}\0${meter}\0${hour.getTime()}`;
    const found = this.#pending.get(key);
    if (found) found.amount += amount;
    else this.#pending.set(key, { org, meter, hour, amount });
    this.#timer ??= setTimeout(() => void this.flush(), FLUSH_MS).unref();
  }

  pendingFor(org: string, from: Date) {
    const totals = new Map<Meter, bigint>();
    for (const row of this.#pending.values()) {
      if (row.org !== org || row.hour < hourOf(from)) continue;
      totals.set(row.meter, (totals.get(row.meter) ?? 0n) + row.amount);
    }
    return totals;
  }

  flush() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const rows = [...this.#pending.values()];
    this.#pending = new Map();
    this.#flushing = this.#flushing.then(() => this.#write(rows));
    return this.#flushing;
  }

  async #write(rows: Pending[]) {
    try {
      await billing.addUsage(this.#db, rows);
    } catch (error) {
      for (const row of rows) {
        const key = `${row.org}\0${row.meter}\0${row.hour.getTime()}`;
        const found = this.#pending.get(key);
        if (found) found.amount += row.amount;
        else this.#pending.set(key, row);
      }
      this.#timer ??= setTimeout(() => void this.flush(), FLUSH_MS).unref();
      this.#log({ level: "error", msg: "billing usage not saved", error: messageOf(error) });
    }
  }
}
