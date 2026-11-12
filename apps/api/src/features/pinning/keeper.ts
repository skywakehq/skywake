import type { Stores } from "../../engine/stores.ts";
import { messageOf } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";
import { MAIN } from "../indexes/lifecycle.ts";
import { openOptions } from "../indexes/queries.ts";
import type { IndexUsage } from "../indexes/usage.ts";
import type { PinnedRow } from "./queries.ts";

interface Replica {
  version: string | null;
  warm: boolean;
  warming: boolean;
}

export class Keeper {
  readonly #replicas = new Map<string, Replica>();
  readonly #stores: Stores;
  readonly #usage: IndexUsage;
  readonly #log: Log;

  constructor(stores: Stores, usage: IndexUsage, log: Log) {
    this.#stores = stores;
    this.#usage = usage;
    this.#log = log;
  }

  async keep(rows: PinnedRow[]) {
    const wanted = new Set(rows.map((row) => row.folder));
    for (const folder of this.#replicas.keys()) {
      if (wanted.has(folder)) continue;
      this.#stores.release(folder);
      this.#replicas.delete(folder);
    }
    await Promise.all(rows.map((row) => this.#refresh(row)));
  }

  isWarm(folder: string) {
    return this.#replicas.get(folder)?.warm ?? false;
  }

  async #refresh(row: PinnedRow) {
    let replica = this.#replicas.get(row.folder);
    if (!replica) {
      this.#stores.hold(row.folder);
      replica = { version: null, warm: false, warming: false };
      this.#replicas.set(row.folder, replica);
    }
    if (replica.warming) return;
    replica.warming = true;
    try {
      const store = this.#stores.index(row.region, row.folder, openOptions(row));
      const [head] = await store.versions(MAIN, null, 1);
      const version = head?.version ?? "";
      if (replica.warm && version === replica.version) return;
      replica.warm = false;
      await store.warm(MAIN);
      this.#usage.sized(row.org, row.name, await store.stats(MAIN));
      Object.assign(replica, { version, warm: true });
    } catch (error) {
      this.#log({
        level: "warn",
        msg: "pinned index not warmed",
        folder: row.folder,
        error: messageOf(error),
      });
    } finally {
      replica.warming = false;
    }
  }
}
