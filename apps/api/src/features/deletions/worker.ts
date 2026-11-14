// Deletes the folders of deleted namespaces and indexes. Every API server runs
// one; a deletion is claimed by one server at a time and retried until it
// succeeds, so a server that dies or a bucket that refuses for a while costs
// only time. Each try lists what is left, so a retry carries on.

import { rm } from "node:fs/promises";

import { Index } from "@skywake/engine";

import type { Db } from "../../db/client.ts";
import type { Stores } from "../../engine/stores.ts";
import { messageOf } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";
import * as deletions from "./queries.ts";

const TICK_MS = 5_000;
const AT_ONCE = 2;

export class Deleter {
  readonly #id: string;
  readonly #db: Db;
  readonly #stores: Stores;
  readonly #log: Log;
  #timer: NodeJS.Timeout | undefined;
  /** The last drain asked for; each waits for the one before, so one runs at a time. */
  #chain: Promise<unknown> = Promise.resolve();
  #queued = 0;

  constructor(id: string, db: Db, stores: Stores, log: Log) {
    this.#id = id;
    this.#db = db;
    this.#stores = stores;
    this.#log = log;
  }

  start() {
    this.#timer = setInterval(() => {
      if (this.#queued > 0) return;
      this.drain().catch((error: unknown) =>
        this.#log({ level: "warn", msg: "deletions not claimed", error: messageOf(error) }),
      );
    }, TICK_MS);
    this.#timer.unref();
  }

  async stop() {
    clearInterval(this.#timer);
    await this.#chain;
  }

  /**
   * Deletes what is due, after any drain already running, and waits for the
   * end. Returns how many folders were deleted.
   */
  drain(): Promise<number> {
    this.#queued++;
    const run = this.#chain.then(() => this.#drainNow());
    this.#chain = run.catch(() => {}).finally(() => this.#queued--);
    return run;
  }

  async #drainNow() {
    let deleted = 0;
    for (;;) {
      const rows = await deletions.claim(this.#db, this.#id, AT_ONCE);
      if (rows.length === 0) return deleted;
      const done = await Promise.all(rows.map((row) => this.#delete(row)));
      deleted += done.filter(Boolean).length;
    }
  }

  async #delete(row: deletions.DeletionRow) {
    try {
      await this.#stores.ready(row.region);
      this.#stores.close(row.folder);
      const location = this.#stores.location(row.region, row.folder);
      // An index's destroy deletes every object under its folder, whatever wrote them.
      await Index.open(location, { keys: this.#stores.keysOf(row.region) }).destroy();
      // A folder on disk also holds its lock file, which no object listing shows.
      if (!/^[a-z0-9+]+:\/\//.test(location)) await rm(location, { recursive: true, force: true });
      await deletions.done(this.#db, row, this.#id);
      return true;
    } catch (error) {
      const message = messageOf(error);
      this.#log({
        level: "warn",
        msg: "folder not deleted yet",
        org: row.org,
        kind: row.kind,
        folder: row.folder,
        attempts: row.attempts + 1,
        error: message,
      });
      await deletions.failed(this.#db, row, this.#id, message).catch(() => {});
      return false;
    }
  }
}
