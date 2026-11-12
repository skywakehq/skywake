import type { Role } from "@skywake/contract";
import type { Engine, Index } from "@skywake/engine";

import type { Changes } from "../db/changes.ts";
import type { Db } from "../db/client.ts";
import type { Stores } from "../engine/stores.ts";
import * as indexes from "../features/indexes/queries.ts";
import * as namespaces from "../features/namespaces/queries.ts";
import { notFound, unauthorized } from "../http/errors.ts";
import { Remembered } from "./remembered.ts";
import { allow, type Caller } from "./roles.ts";

export interface Namespace extends namespaces.NamespaceRow {
  engine: Engine;
}

export interface SearchIndex extends indexes.IndexRow {
  store: Index;
}

/** How long an index row is kept for reads when no notice of its change arrives. */
const ROW_TTL_MS = 30_000;

const rowKey = (org: string, name: string) => `${org}\0${name}`;

export class Access {
  readonly #db: Db;
  readonly #stores: Stores;
  readonly #changes: Changes | null;
  readonly #rows = new Remembered<indexes.IndexRow | null>(ROW_TTL_MS);

  constructor(db: Db, stores: Stores, changes?: Changes) {
    this.#db = db;
    this.#stores = stores;
    this.#changes = changes ?? null;
    changes?.on((change) => {
      if (change === null) this.#rows.clear();
      else if (change.table === "indexes" && change.org && change.name) {
        this.#rows.drop(rowKey(change.org, change.name));
      }
    });
  }

  async namespace(caller: Caller | null, ref: string, role: Role): Promise<Namespace> {
    const at = ref.indexOf(":");
    const org = at < 0 ? caller?.org : ref.slice(0, at);
    const name = at < 0 ? ref : ref.slice(at + 1);
    if (!org) throw unauthorized();

    if (caller?.org === org) {
      allow(caller, role, name);
      const row = await namespaces.find(this.#db, org, name);
      if (!row) throw notFound(`namespace \`${name}\``);
      return this.#open(row);
    }

    const row = await namespaces.find(this.#db, org, name);
    if (row?.visibility === "public" && role === "read") return this.#open(row);
    if (!caller) throw unauthorized();
    throw notFound(`namespace \`${ref}\``);
  }

  /** An index of the caller's own organization. Indexes are never public. */
  async index(caller: Caller, name: string, role: Role): Promise<SearchIndex> {
    allow(caller, role, name);
    const row = await this.#row(caller.org, name, role);
    if (!row) throw notFound(`index \`${name}\``);
    return { ...row, store: this.#stores.index(row.region, row.folder, indexes.openOptions(row)) };
  }

  /** Reads use the row remembered; anything that changes data reads it again. */
  async #row(org: string, name: string, role: Role) {
    const changes = this.#changes;
    const load = () => indexes.find(this.#db, org, name);
    if (role !== "read" || !changes) return load();
    return this.#rows.get(rowKey(org, name), load, (row) => row !== null && changes.listening);
  }

  #open(row: namespaces.NamespaceRow): Namespace {
    return { ...row, engine: this.#stores.engine(row.region, row.folder) };
  }
}
