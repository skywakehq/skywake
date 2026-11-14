// Keeps linked indexes up with their branches. Every API server runs a Syncer:
// it claims due branches from Postgres (SKIP LOCKED, so servers never share
// one), diffs the commit the index matches against the branch's head, and
// writes only what changed. The diff is between trees, so it sees saves
// written straight to the bucket as well as commits through the API.

import { matchesGlob } from "node:path";

import type { indexes as contract } from "@skywake/contract";
import { blake3, type Changed, type Engine, type Index } from "@skywake/engine";

import type { Db } from "../../db/client.ts";
import type { Stores } from "../../engine/stores.ts";
import type { Log } from "../../http/log.ts";
import { isMissing, messageOf } from "../../http/errors.ts";
import { Texts } from "../indexes/embeddings.ts";
import type { Models } from "../indexes/models.ts";
import { MAIN } from "../indexes/lifecycle.ts";
import * as indexes from "../indexes/queries.ts";
import * as rules from "../indexes/rules/index.ts";
import type { IndexUsage } from "../indexes/usage.ts";
import * as namespaces from "../namespaces/queries.ts";
import * as links from "./queries.ts";

const TICK_MS = 1_000;
const PRUNE_MS = 60 * 60_000;
/** Stamps older than this go: a fork from one this old indexes the branch in full instead. */
const STAMP_DAYS = 30;
const BATCH_DOCS = 1_000;
const BATCH_BYTES = 24 << 20;
const LIST_PAGE = 1_000;
const ID_MAX = 256;
/** What is embedded of a file, when the index embeds: its start. */
export const SUMMARY_CHARS = 8_000;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** A file's document id: its path, or a hash of it when the path is too long to be one. */
export function docId(path: string) {
  if (path.length <= ID_MAX) return path;
  return `h:${blake3(Buffer.from(path)).toString("hex")}`;
}

/** `path` as a glob that matches only itself, and everything under it with `/*`. */
function literal(path: string) {
  return path.replace(/[*?[]/g, (c) => `[${c}]`);
}

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
    }

    const writer = new Writer(index, row.branch, indexRow, this.#usage, this.#models);
    const reader = new Reader(engine, row.branch, head, link);
    if (row.synced === null) {
      await reader.walk("", (doc) => writer.upsert(doc));
      await writer.flush();
      await writer.deleteMissing();
    } else {
      for (const change of await engine.diffCommits(row.synced, head)) {
        await this.#apply(change, reader, writer);
      }
      await writer.flush();
    }

    const [version] = await index.versions(row.branch, null, 1);
    if (version) {
      await links.stamp(db, row.org, link.index, row.branch, head, version.version);
    }
    await links.synced(db, row, this.#id, head);
  }

  async #apply(change: Changed, reader: Reader, writer: Writer) {
    if (change.kind === "removed") {
      writer.remove(change.path);
      return;
    }
    // A path that was a folder may now be a file, or the other way: clear it first.
    if (change.kind === "modified") writer.removeUnder(change.path);
    await reader.walk(change.path, (doc) => writer.upsert(doc));
  }
}

interface FileDoc {
  path: string;
  text: string;
}

/** Reads the files of one commit that the link wants indexed. */
class Reader {
  readonly #engine: Engine;
  readonly #branch: string;
  readonly #at: string;
  readonly #link: links.Link;

  constructor(engine: Engine, branch: string, at: string, link: links.Link) {
    this.#engine = engine;
    this.#branch = branch;
    this.#at = at;
    this.#link = link;
  }

  wanted(path: string) {
    const { include, exclude } = this.#link;
    if (include.length > 0 && !include.some((glob) => matchesGlob(path, glob))) return false;
    return !exclude.some((glob) => matchesGlob(path, glob));
  }

  /** Every wanted file at or under `path`, one page of a folder at a time. */
  async walk(path: string, each: (doc: FileDoc) => Promise<void>) {
    const listing = await this.#engine.list(this.#branch, path, this.#at, null, LIST_PAGE);
    if (listing.info.kind === "file") {
      const doc = await this.#read(path, listing.info.size);
      if (doc) await each(doc);
      return;
    }
    if (listing.info.kind !== "folder") return;
    let entries = listing.entries;
    for (;;) {
      for (const entry of entries) {
        const child = path === "" ? entry.name : `${path}/${entry.name}`;
        if (entry.kind === "folder") await this.walk(child, each);
        else if (entry.kind === "file") {
          const doc = await this.#read(child, entry.size);
          if (doc) await each(doc);
        }
      }
      if (entries.length < LIST_PAGE) return;
      const after = entries.at(-1)!.name;
      entries = (await this.#engine.list(this.#branch, path, this.#at, after, LIST_PAGE)).entries;
    }
  }

  async #read(path: string, size: number): Promise<FileDoc | null> {
    if (size > this.#link.maxBytes || !this.wanted(path)) return null;
    const bytes = await this.#engine.read(this.#branch, path, null, null, this.#at);
    if (bytes.includes(0)) return null;
    try {
      return { path, text: utf8.decode(bytes) };
    } catch {
      return null;
    }
  }
}

/** Batches writes to one index branch, embedding and billing as the API does. */
class Writer {
  readonly #index: Index;
  readonly #branch: string;
  readonly #row: indexes.IndexRow;
  readonly #usage: IndexUsage;
  readonly #models: Models;
  readonly #summary: boolean;
  #upserts: contract.Document[] = [];
  #bytes = 0;
  #deletes: string[] = [];
  #folders: string[] = [];
  readonly #seen = new Set<string | number>();

  constructor(
    index: Index,
    branch: string,
    row: indexes.IndexRow,
    usage: IndexUsage,
    models: Models,
  ) {
    this.#index = index;
    this.#branch = branch;
    this.#row = row;
    this.#usage = usage;
    this.#models = models;
    this.#summary = row.schema.attributes.some((column) => column.name === "summary");
  }

  async upsert(doc: FileDoc) {
    const id = docId(doc.path);
    this.#seen.add(id);
    const attributes: Record<string, string> = { path: doc.path, text: doc.text };
    if (this.#summary) attributes.summary = doc.text.slice(0, SUMMARY_CHARS) || doc.path;
    this.#upserts.push({ id, vectors: {}, attributes });
    this.#bytes += Buffer.byteLength(doc.text) + doc.path.length * 2;
    if (this.#upserts.length >= BATCH_DOCS || this.#bytes >= BATCH_BYTES) await this.flush();
  }

  /** A removed path: the file's document, and the documents of everything under it. */
  remove(path: string) {
    this.#deletes.push(docId(path));
    this.removeUnder(path);
  }

  removeUnder(path: string) {
    if (path !== "") this.#folders.push(`${literal(path)}/*`);
  }

  async flush() {
    if (this.#upserts.length === 0 && this.#deletes.length === 0 && this.#folders.length === 0) {
      return;
    }
    const body: contract.Write = {
      upserts: this.#upserts.length > 0 ? this.#upserts : undefined,
      deletes: this.#deletes.length > 0 ? this.#deletes : undefined,
      deleteBy:
        this.#folders.length > 0
          ? { or: this.#folders.map((glob) => ({ path: { glob } })) }
          : undefined,
    };
    const texts = new Texts();
    const write = rules.write(this.#row.schema, body, texts);
    const bill = this.#usage.bill(this.#row);
    if (this.#upserts.length > 0) await bill.admit("writes");
    await texts.embed(this.#models, bill);
    const done = await this.#index.write(this.#branch, { ...write, exactDeletes: true });
    bill.count("writes", done.upserted);
    bill.count("deletes", done.deleted);
    bill.wrote(this.#bytes);
    this.#upserts = [];
    this.#deletes = [];
    this.#folders = [];
    this.#bytes = 0;
  }

  /** After indexing a whole tree: deletes the documents of files it no longer has. */
  async deleteMissing() {
    const gone: (string | number)[] = [];
    let after: string | number | null = null;
    for (;;) {
      const page = await this.#index.scan(this.#branch, after, LIST_PAGE);
      for (const doc of page) if (!this.#seen.has(doc.id)) gone.push(doc.id);
      if (page.length < LIST_PAGE) break;
      after = page.at(-1)!.id;
    }
    for (let at = 0; at < gone.length; at += BATCH_DOCS) {
      await this.#index.write(this.#branch, { deletes: gone.slice(at, at + BATCH_DOCS) });
    }
  }
}
