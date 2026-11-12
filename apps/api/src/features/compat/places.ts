import { Remembered } from "../../auth/remembered.ts";
import type { Changes } from "../../db/changes.ts";
import type { Db } from "../../db/client.ts";
import * as names from "./queries.ts";

const TTL_MS = 30_000;

const keyOf = (org: string, name: string) => `${org}\0${name}`;

export class Places {
  readonly #db: Db;
  readonly #changes: Changes | null;
  readonly #rows = new Remembered<names.NameRow | null>(TTL_MS);

  constructor(db: Db, changes?: Changes) {
    this.#db = db;
    this.#changes = changes ?? null;
    changes?.on((change) => {
      if (change === null) this.#rows.clear();
      else if (change.table === "compat_namespaces" && change.org && change.name) {
        this.#rows.drop(keyOf(change.org, change.name));
      }
    });
  }

  async find(org: string, name: string, fresh: boolean) {
    const changes = this.#changes;
    const load = async () => (await names.find(this.#db, org, name)) ?? null;
    if (fresh || !changes) return load();
    return this.#rows.get(keyOf(org, name), load, () => changes.listening);
  }
}
