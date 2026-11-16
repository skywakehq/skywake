import { ancestors, below, name, parent, rebase, within } from "./paths.ts";

export type Pending =
  | { kind: "file"; bytes: Uint8Array; mode: number; mtime: Date }
  | { kind: "folder"; mode: number; mtime: Date }
  | { kind: "copy"; from: string }
  | { kind: "gone" };

export type Held = Exclude<Pending, { kind: "copy" | "gone" }>;

export type Located = { pending: Held } | { base: string } | null;

export class Changes {
  #entries = new Map<string, Pending>();

  get size(): number {
    return this.#entries.size;
  }

  set(path: string, entry: Pending) {
    for (const key of this.#entries.keys()) if (below(key, path)) this.#entries.delete(key);
    this.#entries.set(path, entry);
  }

  clear() {
    this.#entries.clear();
  }

  paths(): string[] {
    return [...this.#entries].filter(([, entry]) => entry.kind !== "gone").map(([path]) => path);
  }

  sorted(): [string, Pending][] {
    return [...this.#entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  children(folder: string): [string, Pending][] {
    return [...this.#entries]
      .filter(([path]) => path !== "/" && parent(path) === folder)
      .map(([path, entry]) => [name(path), entry]);
  }

  touches(path: string): boolean {
    for (const key of this.#entries.keys()) if (within(key, path)) return true;
    return false;
  }

  locate(path: string): Located {
    const entry = this.#entries.get(path);
    if (!entry) return this.beneath(path);
    if (entry.kind === "gone") return null;
    if (entry.kind === "copy") return { base: entry.from };
    return { pending: entry };
  }

  beneath(path: string): Located {
    for (const folder of ancestors(path)) {
      const entry = this.#entries.get(folder);
      if (!entry) continue;
      if (entry.kind === "copy") return { base: rebase(path, folder, entry.from) };
      return null;
    }
    return { base: path };
  }
}
