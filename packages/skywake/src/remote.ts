import type { Disk, Entry } from "@skywake/sdk";

import { isMissing } from "./errors.ts";
import { join, name, parent, remote } from "./paths.ts";
import { trusted } from "./trusted.ts";

export interface RemoteEntry {
  name: string;
  kind: Entry["kind"];
  size: number;
  executable: boolean;
  modified: number;
  target?: string;
}

const CACHED_BYTES = 1 << 20;

const ROOT: RemoteEntry = { name: "", kind: "folder", size: 0, executable: false, modified: 0 };

const entryOf = (entry: Entry): RemoteEntry => ({
  name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
  kind: entry.kind,
  size: entry.size,
  executable: entry.executable,
  modified: entry.modified ? Date.parse(entry.modified) : 0,
  ...(entry.target === undefined ? {} : { target: entry.target }),
});

export class Remote {
  #head: Promise<string> | undefined;
  #stats = new Map<string, Promise<RemoteEntry | null>>();
  #lists = new Map<string, Promise<Map<string, RemoteEntry>>>();
  #reads = new Map<string, Promise<Uint8Array>>();

  readonly disk: Disk;

  constructor(disk: Disk) {
    this.disk = disk;
  }

  head(): Promise<string> {
    this.#head ??= trusted(() => this.disk.head()).then(
      (head) => head ?? "",
      (error) => {
        if (isMissing(error)) return "";
        throw error;
      },
    );
    return this.#head;
  }

  moved(head: string) {
    this.#head = Promise.resolve(head);
    this.#stats.clear();
    this.#lists.clear();
    this.#reads.clear();
  }

  stat(path: string): Promise<RemoteEntry | null> {
    if (path === "/") return Promise.resolve(ROOT);
    let stat = this.#stats.get(path);
    if (!stat) {
      stat = this.#fetchStat(path);
      this.#stats.set(path, stat);
    }
    return stat;
  }

  list(path: string): Promise<Map<string, RemoteEntry>> {
    let list = this.#lists.get(path);
    if (!list) {
      list = this.#fetchList(path);
      this.#lists.set(path, list);
    }
    return list;
  }

  async read(path: string): Promise<Uint8Array> {
    const cached = this.#reads.get(path);
    if (cached) return cached;
    const read = this.head().then((at) =>
      trusted(() => this.disk.read(remote(path), { at: at || undefined, as: "bytes" })),
    );
    const entry = await this.stat(path);
    if (entry && entry.size <= CACHED_BYTES) this.#reads.set(path, read);
    return read;
  }

  async #fetchStat(path: string): Promise<RemoteEntry | null> {
    try {
      return (await this.list(parent(path))).get(name(path)) ?? null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async #fetchList(path: string): Promise<Map<string, RemoteEntry>> {
    const at = await this.head();
    const entries = new Map<string, RemoteEntry>();
    if (!at) return entries;
    await trusted(async () => {
      for await (const found of this.disk.entries(remote(path), { at })) {
        const entry = entryOf(found);
        entries.set(entry.name, entry);
        this.#stats.set(join(path, entry.name), Promise.resolve(entry));
      }
    });
    return entries;
  }
}
