import { matchesGlob } from "node:path";

import type { Engine } from "@skywake/engine";

import type * as links from "./queries.ts";

const LIST_PAGE = 1_000;
const IMAGE_BYTES_MAX = 5 << 20;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export type FileDoc =
  | { kind: "text"; path: string; text: string }
  | { kind: "image"; path: string; image: string }
  | { kind: "skipped"; path: string; reason: string };

export interface ReaderOptions {
  images: boolean;
  after?: string | null;
}

export function walkOrder(a: string, b: string) {
  const left = a.split("/");
  const right = b.split("/");
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i]! < right[i]! ? -1 : 1;
  }
  return left.length - right.length;
}

export function imageType(path: string) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? undefined : IMAGE_TYPES[path.slice(dot + 1).toLowerCase()];
}

export class Reader {
  readonly #engine: Engine;
  readonly #branch: string;
  readonly #at: string;
  readonly #link: links.Link;
  readonly #images: boolean;
  readonly #after: string | null;

  constructor(
    engine: Engine,
    branch: string,
    at: string,
    link: links.Link,
    options: ReaderOptions,
  ) {
    this.#engine = engine;
    this.#branch = branch;
    this.#at = at;
    this.#link = link;
    this.#images = options.images;
    this.#after = options.after ?? null;
  }

  wanted(path: string) {
    const { include, exclude } = this.#link;
    if (include.length > 0 && !include.some((glob) => matchesGlob(path, glob))) return false;
    return !exclude.some((glob) => matchesGlob(path, glob));
  }

  async walk(path: string, each: (doc: FileDoc) => Promise<void>) {
    await this.#visit(path, async (file, size) => {
      const doc = await this.#read(file, size);
      if (doc) await each(doc);
    });
  }

  async paths(path: string) {
    const found = new Set<string>();
    await this.#visit(
      path,
      async (file) => {
        if (this.wanted(file)) found.add(file);
      },
      false,
    );
    return found;
  }

  async #visit(
    path: string,
    each: (path: string, size: number) => Promise<void>,
    resume = true,
  ) {
    const listing = await this.#engine.list(this.#branch, path, this.#at, null, LIST_PAGE);
    if (listing.info.kind === "file") {
      if (!resume || this.#due(path)) await each(path, listing.info.size);
      return;
    }
    if (listing.info.kind !== "folder") return;
    let entries = listing.entries;
    for (;;) {
      for (const entry of entries) {
        const child = path === "" ? entry.name : `${path}/${entry.name}`;
        if (entry.kind === "folder") {
          if (!resume || this.#holdsDue(child)) await this.#visit(child, each, resume);
        } else if (entry.kind === "file" && (!resume || this.#due(child))) {
          await each(child, entry.size);
        }
      }
      if (entries.length < LIST_PAGE) return;
      const after = entries.at(-1)!.name;
      entries = (await this.#engine.list(this.#branch, path, this.#at, after, LIST_PAGE)).entries;
    }
  }

  #due(path: string) {
    return this.#after === null || walkOrder(path, this.#after) > 0;
  }

  #holdsDue(folder: string) {
    return this.#after === null || this.#after.startsWith(`${folder}/`) || this.#due(folder);
  }

  async #read(path: string, size: number): Promise<FileDoc | null> {
    if (!this.wanted(path)) return null;
    const type = this.#images ? imageType(path) : undefined;
    const limit = type ? Math.max(this.#link.maxBytes, IMAGE_BYTES_MAX) : this.#link.maxBytes;
    if (size > limit) {
      return { kind: "skipped", path, reason: `larger than ${Math.round(limit / 1024)} KiB` };
    }
    const bytes = await this.#engine.read(this.#branch, path, null, null, this.#at);
    if (type) {
      return { kind: "image", path, image: `data:${type};base64,${bytes.toString("base64")}` };
    }
    if (bytes.includes(0)) return { kind: "skipped", path, reason: "binary" };
    try {
      return { kind: "text", path, text: utf8.decode(bytes) };
    } catch {
      return { kind: "skipped", path, reason: "not UTF-8 text" };
    }
  }
}
