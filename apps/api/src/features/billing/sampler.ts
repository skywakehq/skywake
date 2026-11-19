import type { Db } from "../../db/client.ts";
import type { Stores } from "../../engine/stores.ts";
import { messageOf } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";
import { openOptions } from "../indexes/queries.ts";
import { hourOf } from "./ledger.ts";
import * as billing from "./queries.ts";

export type Sized = (org: string, index: string, stats: { rows: number; bytes: number }) => void;

const MAIN = "main";

export class Sampler {
  readonly #db: Db;
  readonly #stores: Stores;
  readonly #sized: Sized;
  readonly #log: Log;
  readonly #now: () => Date;
  #last: number | null = null;

  constructor(db: Db, stores: Stores, sized: Sized, log: Log, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#stores = stores;
    this.#sized = sized;
    this.#log = log;
    this.#now = now;
  }

  async run() {
    const hour = hourOf(this.#now());
    if (this.#last === hour.getTime()) return;
    await this.#indexes(hour);
    this.#last = hour.getTime();
  }

  #regions() {
    return new Set(this.#stores.list().map((region) => region.name));
  }

  async #indexes(hour: Date) {
    const stored = new Map<string, bigint>();
    const regions = this.#regions();
    for (const row of (await billing.allIndexes(this.#db)).filter((row) =>
      regions.has(row.region),
    )) {
      try {
        const store = this.#stores.index(row.region, row.folder, openOptions(row));
        const stats = await store.stats(MAIN);
        this.#sized(row.org, row.name, stats);
        stored.set(row.org, (stored.get(row.org) ?? 0n) + BigInt(stats.bytes));
      } catch (error) {
        this.#log({
          level: "warn",
          msg: "index not sized for billing",
          org: row.org,
          index: row.name,
          error: messageOf(error),
        });
      }
    }
    await billing.setUsage(
      this.#db,
      [...stored].map(([org, amount]) => ({ org, meter: "storage" as const, hour, amount })),
    );
  }
}
