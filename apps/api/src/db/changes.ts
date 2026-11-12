import type pg from "pg";

import { messageOf } from "../http/errors.ts";
import type { Log } from "../http/log.ts";
import type { Db } from "./client.ts";

const CHANNEL = "skywake_changes";
const RETRY_MS = 1000;

/** A row of keys, orgs, indexes or compat_namespaces that changed (see migration 0019). */
export interface Change {
  table: string;
  id?: string;
  org?: string;
  name?: string;
}

/**
 * Listens for the notices Postgres sends after each commit that changes a
 * remembered row. While not listening, nothing remembered can be trusted, so
 * every listener hears `null` (forget everything) when the connection drops
 * and again once it is back.
 */
export class Changes {
  readonly #pool: pg.Pool;
  readonly #log: Log;
  readonly #listeners: ((change: Change | null) => void)[] = [];
  #client: pg.PoolClient | null = null;
  #stopped = false;
  #listening = false;

  constructor(db: Db, log: Log) {
    this.#pool = (db as Db & { $client: pg.Pool }).$client;
    this.#log = log;
  }

  /** True while notices arrive; until then, nothing should be remembered. */
  get listening() {
    return this.#listening;
  }

  on(listener: (change: Change | null) => void) {
    this.#listeners.push(listener);
  }

  async start() {
    this.#stopped = false;
    try {
      const client = await this.#pool.connect();
      this.#client = client;
      client.on("notification", (message) => {
        if (message.channel !== CHANNEL || !message.payload) return;
        try {
          this.#tell(JSON.parse(message.payload) as Change);
        } catch {
          this.#tell(null);
        }
      });
      client.on("error", () => this.#lost(client));
      client.on("end", () => this.#lost(client));
      await client.query(`LISTEN ${CHANNEL}`);
      this.#tell(null);
      this.#listening = true;
    } catch (error) {
      this.#log({ level: "warn", msg: "could not listen for changes", error: messageOf(error) });
      this.#retry();
    }
  }

  async stop() {
    this.#stopped = true;
    this.#listening = false;
    this.#tell(null);
    const client = this.#client;
    this.#client = null;
    if (client) {
      await client.query(`UNLISTEN ${CHANNEL}`).catch(() => {});
      client.release();
    }
  }

  #lost(client: pg.PoolClient) {
    if (this.#client !== client) return;
    this.#client = null;
    this.#listening = false;
    this.#tell(null);
    client.release(true);
    this.#retry();
  }

  #retry() {
    if (!this.#stopped) setTimeout(() => void this.start(), RETRY_MS).unref();
  }

  #tell(change: Change | null) {
    for (const listener of this.#listeners) listener(change);
  }
}
