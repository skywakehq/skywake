import type { Branch, Schemas } from "@skywake/sdk";

import { isMissing } from "./errors.ts";
import { join, name, parent, remote } from "./paths.ts";
import { trusted } from "./trusted.ts";

export type RemoteEntry = Schemas["FileInfo"];

const CACHED_BYTES = 1 << 20;

const ROOT: RemoteEntry = { name: "", kind: "folder", size: 0, executable: false, modified: 0 };

export class Remote {
  #head: Promise<string> | undefined;
  #stats = new Map<string, Promise<RemoteEntry | null>>();
  #lists = new Map<string, Promise<Map<string, RemoteEntry>>>();
  #reads = new Map<string, Promise<Uint8Array>>();

  readonly branch: Branch;

  constructor(branch: Branch) {
    this.branch = branch;
  }

  head(): Promise<string> {
    this.#head ??= trusted(() => this.branch.info()).then((info) => info.head);
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
    const read = this.head().then((at) => trusted(() => this.branch.read(remote(path), { at })));
    const entry = await this.stat(path);
    if (entry && entry.size <= CACHED_BYTES) this.#reads.set(path, read);
    return read;
  }

  async #fetchStat(path: string): Promise<RemoteEntry | null> {
    const listed = this.#lists.get(parent(path));
    if (listed) return (await listed).get(name(path)) ?? null;
    try {
      const at = await this.head();
      const listed = trusted(() => this.branch.list(remote(path), { at, limit: 1 }));
      const { entries: _, ...entry } = await listed;
      return entry;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async #fetchList(path: string): Promise<Map<string, RemoteEntry>> {
    const at = await this.head();
    const entries = new Map<string, RemoteEntry>();
    await trusted(async () => {
      for await (const entry of this.branch.allEntries(remote(path), { at })) {
        entries.set(entry.name, entry);
        this.#stats.set(join(path, entry.name), Promise.resolve(entry));
      }
    });
    return entries;
  }
}
