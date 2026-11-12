import { Engine } from "@skywake/engine";

import type { Db } from "../../db/client.ts";
import type { Stores } from "../../engine/stores.ts";
import { messageOf } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";
import { openOptions } from "../indexes/queries.ts";
import { hourOf } from "./ledger.ts";
import * as billing from "./queries.ts";

export type Sized = (org: string, index: string, stats: { rows: number; bytes: number }) => void;

const MAIN = "main";
const REMEASURE_MS = 24 * 60 * 60 * 1000;
const MEASURE_ONE_MS = 60_000;
const MEASURE_ALL_MS = 10 * 60_000;

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
    await this.#filesystems(hour);
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

  async #filesystems(hour: Date) {
    const now = this.#now();
    const stored = new Map<string, bigint>();
    const regions = this.#regions();
    const until = Date.now() + MEASURE_ALL_MS;
    for (const row of await billing.allFilesystems(this.#db)) {
      let bytes = row.bytes;
      const due =
        bytes === null ||
        row.stale ||
        !row.measured ||
        now.getTime() - row.measured.getTime() >= REMEASURE_MS;
      const left = until - Date.now();
      if (due && regions.has(row.region) && left > 0) {
        try {
          const engine = Engine.open(this.#stores.location(row.region, row.folder));
          const found = await engine.stored(Math.min(MEASURE_ONE_MS, left));
          if (found === null) {
            if (bytes !== null) stored.set(row.org, (stored.get(row.org) ?? 0n) + bytes);
            continue;
          }
          bytes = BigInt(found.bytes);
          await billing.saveSize(this.#db, {
            folder: row.folder,
            org: row.org,
            bytes,
            objects: found.objects,
            measured: now,
          });
        } catch (error) {
          this.#log({
            level: "warn",
            msg: "filesystem not sized for billing",
            org: row.org,
            folder: row.folder,
            error: messageOf(error),
          });
        }
      }
      if (bytes !== null) stored.set(row.org, (stored.get(row.org) ?? 0n) + bytes);
    }
    await billing.setUsage(
      this.#db,
      [...stored].map(([org, amount]) => ({ org, meter: "files_storage" as const, hour, amount })),
    );
  }
}
