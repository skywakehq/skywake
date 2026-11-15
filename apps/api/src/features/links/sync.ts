// Keeps linked indexes up with their branches. Every API server runs a Syncer:
// it claims due branches from Postgres (SKIP LOCKED, so servers never share
// one), diffs the commit the index matches against the branch's head, and
// writes only what changed. The diff is between trees, so it sees saves
// written straight to the bucket as well as commits through the API.

import type { Changed, Index } from "@skywake/engine";

import type { Db } from "../../db/client.ts";
import type { Stores } from "../../engine/stores.ts";
import type { Log } from "../../http/log.ts";
import { isMissing, messageOf } from "../../http/errors.ts";
import type { Models } from "../indexes/models.ts";
import { MAIN } from "../indexes/lifecycle.ts";
import * as indexes from "../indexes/queries.ts";
import type { IndexUsage } from "../indexes/usage.ts";
import * as namespaces from "../namespaces/queries.ts";
import * as links from "./queries.ts";
import { Reader } from "./reader.ts";
import { type Shape, shapeOf, SKIPPED_MAX, type Skip, Writer } from "./writer.ts";

export { docId } from "./chunks.ts";
export { literal } from "./writer.ts";

const TICK_MS = 1_000;
const PRUNE_MS = 60 * 60_000;
/** Stamps older than this go: a fork from one this old indexes the branch in full instead. */
const STAMP_DAYS = 30;
const PAGE = 1_000;


export interface SyncerOptions {
  /** Branches this server syncs at once. */
  concurrency?: number;
  every?: number;
}

export class Syncer {
  readonly #id: string;
  readonly #db: Db;
  readonly #stores: Stores;
  readonly #usage: IndexUsage;
  readonly #models: Models;
  readonly #log: Log;
  readonly #concurrency: number;
  readonly #every: number;
  readonly #running = new Set<Promise<void>>();
  #timer: NodeJS.Timeout | undefined;
  #ticking = false;
  #pruned = 0;

  constructor(
    id: string,
    db: Db,
    stores: Stores,
    usage: IndexUsage,
    models: Models,
    log: Log,
    options: SyncerOptions = {},
  ) {
    this.#id = id;
    this.#db = db;
    this.#stores = stores;
    this.#usage = usage;
    this.#models = models;
    this.#log = log;
    this.#concurrency = options.concurrency ?? 8;
    this.#every = options.every ?? TICK_MS;
  }

  start() {
    this.#timer = setInterval(() => void this.#tick(), this.#every);
    this.#timer.unref();
  }

  async stop() {
    clearInterval(this.#timer);
    await Promise.allSettled(this.#running);
  }

  /** Claims what is due and syncs it, waiting for the end: for tests and tools. */
  async drain() {
    let synced = 0;
    for (;;) {
      const rows = await links.claim(this.#db, this.#id, this.#concurrency);
      if (rows.length === 0) return synced;
      await Promise.all(rows.map((row) => this.#sync(row)));
      synced += rows.length;
    }
  }

  async #tick() {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      if (Date.now() - this.#pruned > PRUNE_MS) {
        this.#pruned = Date.now();
        await links.pruneStamps(this.#db, STAMP_DAYS);
      }
      const room = this.#concurrency - this.#running.size;
      if (room <= 0) return;
      for (const row of await links.claim(this.#db, this.#id, room)) {
        const run = this.#sync(row).finally(() => this.#running.delete(run));
        this.#running.add(run);
      }
    } catch (error) {
      this.#log({ level: "warn", msg: "index links not claimed", error: messageOf(error) });
    } finally {
      this.#ticking = false;
    }
  }

  async #sync(row: links.LinkedBranchRow) {
    const keep = setInterval(() => void links.renew(this.#db, row, this.#id), links.CLAIM_MS / 3);
    keep.unref();
    try {
      await this.#syncOnce(row);
    } catch (error) {
      const message = messageOf(error);
      this.#log({
        level: "warn",
        msg: "index link not synced",
        org: row.org,
        namespace: row.namespace,
        branch: row.branch,
        error: message,
      });
      await links.failed(this.#db, row, this.#id, message).catch(() => {});
    } finally {
      clearInterval(keep);
    }
  }


  async #syncOnce(row: links.LinkedBranchRow) {
    const db = this.#db;
    const link = await links.find(db, row.org, row.namespace);
    if (!link) return;
    const ns = await namespaces.find(db, row.org, row.namespace);
    const indexRow = await indexes.find(db, row.org, link.index);
    if (!ns || !indexRow) return;
    await this.#stores.ready(ns.region);
    await this.#stores.ready(indexRow.region);
    const engine = this.#stores.engine(ns.region, ns.folder);
    const index = this.#stores.index(indexRow.region, indexRow.folder, indexes.openOptions(indexRow));

    let head: string;
    try {
      head = await engine.head(row.branch);
    } catch (error) {
      if (!isMissing(error)) throw error;
      // The files branch is gone: stop following it.
      await links.removeBranch(db, row.org, row.namespace, row.branch);
      return;
    }
    if (head === row.synced) {
      await links.synced(db, row, this.#id, head);
      return;
    }
    if (!(await index.branches()).includes(row.branch)) {
      // Linked before its index branch existed: start it empty from `main`'s
      // schema and index the whole tree.
      await indexes.addBranch(db, { org: row.org, index: link.index, name: row.branch }, MAIN);
      await index.fork(MAIN, row.branch, null, indexRow.retentionDays);
      row.synced = null;
      row.cursor = null;
    }

    const shape = shapeOf(indexRow.schema);
    const writer = new Writer(index, row.branch, indexRow, this.#usage, this.#models, shape);
    let at = head;
    let kept: Skip[];
    if (row.synced === null) {
      const resumed = row.cursor !== null && row.cursorAt !== null;
      if (resumed) at = row.cursorAt!;
      const reader = new Reader(engine, row.branch, at, link, {
        images: shape.images,
        after: resumed ? row.cursor : null,
      });
      writer.onFlush = async (last) => {
        if (last) await links.progress(db, row, this.#id, last, at);
      };
      await reader.walk("", (doc) => writer.add(doc));
      await writer.flush();
      await deleteMissing(index, row.branch, await reader.paths(""));
      kept = resumed ? row.skipped.filter((skip) => !writer.cleared.has(skip.path)) : [];
    } else {
      const reader = new Reader(engine, row.branch, head, link, { images: shape.images });
      for (const change of await engine.diffCommits(row.synced, head)) {
        await apply(change, reader, writer);
      }
      await writer.flush();
      kept = row.skipped.filter((skip) => !writer.cleared.has(skip.path));
    }

    const skipped = [...kept, ...writer.skipped].slice(0, SKIPPED_MAX);
    const counts = { ...(await countsOf(index, row.branch, shape)), skipped };
    const [version] = await index.versions(row.branch, null, 1);
    if (version) {
      await links.stamp(db, row.org, link.index, row.branch, at, version.version);
    }
    await links.synced(db, row, this.#id, at, counts);
    if (at !== head) await links.moved(db, row.org, row.namespace, row.branch, true);
  }
}

async function apply(change: Changed, reader: Reader, writer: Writer) {
  if (change.kind === "removed") {
    writer.remove(change.path);
    return;
  }
  if (change.kind === "modified") writer.removeUnder(change.path);
  await reader.walk(change.path, (doc) => writer.add(doc));
}

async function deleteMissing(index: Index, branch: string, wanted: Set<string>) {
  const gone = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const rows = await index.order(branch, {
      by: "path",
      topK: PAGE,
      include: ["path"],
      filter: after === null ? undefined : { path: { gt: after } },
    });
    for (const row of rows) {
      const path = row.attributes.path;
      if (typeof path === "string" && !wanted.has(path)) gone.add(path);
    }
    if (rows.length < PAGE) break;
    after = rows.at(-1)!.attributes.path as string;
  }
  const paths = [...gone];
  for (let at = 0; at < paths.length; at += PAGE) {
    await index.write(branch, { deleteBy: { path: { in: paths.slice(at, at + PAGE) } } });
  }
}

async function countsOf(index: Index, branch: string, shape: Shape) {
  const count = async (filter?: { chunk: { eq: number } }) => {
    const [group] = await index.aggregate(branch, { filter, measures: { n: ["count"] } });
    return Number(group?.values.n ?? 0);
  };
  const chunks = await count();
  const files = shape.chunked ? await count({ chunk: { eq: 0 } }) : chunks;
  return { files, chunks };
}
