import { CONCURRENCY, mapConcurrently } from "../core/concurrency.js";
import { SkywakeError } from "../core/errors.js";
import type { At, Branch } from "../filesystem/branch.js";
import type { SearchIndex } from "./search-index.js";
import type { DocId, Document } from "./types.js";

// `changes` returns at most this many commits, the newest ones. A full answer
// may have skipped some, so the sync then compares whole trees instead.
const FEED_MAX = 1000;
// The API takes upserts of at most 32 MiB. JSON's length counts characters,
// and one character is at most 3 bytes, so this stays under it.
const UPSERT_CHARS = 8 * 1024 * 1024;
const UPSERT_MAX = 1000;

/** A file of the branch, as it is at the commit the sync reached. */
export interface SyncedFile {
  path: string;
  bytes: Uint8Array;
}

export interface SyncOptions {
  /**
   * The commit the index was last synced to: the `head` an earlier sync
   * returned. Without it, every file is upserted and nothing is deleted.
   */
  since?: string;
  /**
   * Turns a file into its document, or `null` to keep it out of the index
   * (after a `since`, its document is deleted). By default, a UTF-8 file becomes
   * `{id: path, attributes: {path, text}}` and other files are left out.
   */
  document?: (file: SyncedFile) => Document | null | Promise<Document | null>;
  /** The id of a file's document, to delete it. The path by default; it must match `document`. */
  id?: (path: string) => DocId;
  /** How many files to read at once. 8 by default. */
  concurrency?: number;
}

export interface Synced {
  /** The commit the index now matches. Pass it as `since` next time. */
  head: string;
  upserted: number;
  /** As the API counts them, which may include ids that had no document. */
  deleted: number;
}

/**
 * Brings `index` up to date with the files of `branch`: upserts the files that
 * changed since `options.since` and deletes the documents of files that went.
 * Folders count by the files they hold; symlinks are left out.
 */
export async function syncIndex(
  branch: Branch,
  index: SearchIndex,
  options: SyncOptions = {},
): Promise<Synced> {
  const { since, document = textDocument, id = (path: string) => path } = options;
  const concurrency = options.concurrency ?? CONCURRENCY;

  // Each path that changed, and whether something there may have gone.
  let touched: Map<string, boolean>;
  let head: string;
  if (since === undefined) {
    head = (await branch.info()).head;
    touched = new Map([["", false]]);
  } else {
    const feed = await branch.changes(since, FEED_MAX);
    if (feed.length === 0) return { head: since, upserted: 0, deleted: 0 };
    head = feed[feed.length - 1]!.hash;
    touched = new Map();
    if (feed.length === FEED_MAX) touched.set("", true);
    else {
      for (const { changes } of feed) {
        for (const { path, kind } of changes) {
          touched.set(path, touched.get(path) === true || kind !== "added");
        }
      }
    }
  }

  const now = new Set<string>();
  const before = new Set<string>();
  await mapConcurrently([...touched], concurrency, async ([path, mayHaveGone]) => {
    for (const file of await filesUnder(branch, path, { at: head })) now.add(file);
    if (mayHaveGone && since !== undefined) {
      for (const file of await filesUnder(branch, path, { at: since })) before.add(file);
    }
  });
  const gone = [...before].filter((path) => !now.has(path));

  let upserted = 0;
  let pending: Document[] = [];
  let size = 0;
  const flush = async () => {
    if (pending.length > 0) upserted += await index.upsert(pending);
    pending = [];
    size = 0;
  };
  const paths = [...now];
  // Read a slice at a time, so only one slice of files is in memory.
  for (let i = 0; i < paths.length; i += UPSERT_MAX) {
    const slice = paths.slice(i, i + UPSERT_MAX);
    const documents = await mapConcurrently(slice, concurrency, async (path) =>
      document({ path, bytes: await branch.read(path, { at: head }) }),
    );
    for (const [j, found] of documents.entries()) {
      if (found === null) {
        // Only a file that changed can have an older document to remove.
        if (since !== undefined) gone.push(slice[j]!);
        continue;
      }
      const length = JSON.stringify(found).length;
      if (pending.length === UPSERT_MAX || size + length > UPSERT_CHARS) await flush();
      pending.push(found);
      size += length;
    }
  }
  await flush();

  const deleted = gone.length > 0 ? await index.delete(gone.map(id)) : 0;
  return { head, upserted, deleted };
}

/** The files at or under `path`, or none when nothing is there. */
async function filesUnder(branch: Branch, path: string, options: At): Promise<string[]> {
  let top;
  try {
    top = await branch.list(path, { ...options, limit: 1 });
  } catch (error) {
    if (error instanceof SkywakeError && error.status === 404) return [];
    throw error;
  }
  if (top.kind === "file") return [path];
  if (top.kind !== "folder") return [];
  const files: string[] = [];
  for await (const entry of branch.walk(path, options)) {
    if (entry.kind === "file") files.push(entry.path);
  }
  return files;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function textDocument({ path, bytes }: SyncedFile): Document | null {
  try {
    return { id: path, attributes: { path, text: decoder.decode(bytes) } };
  } catch {
    return null;
  }
}
