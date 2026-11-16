import type { Disk } from "@skywake/sdk";
import type {
  BufferEncoding,
  CpOptions,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  RmOptions,
} from "just-bash";

import { Changes, type Held } from "./changes.ts";
import { changesOf } from "./commit.ts";
import { fail } from "./errors.ts";
import { join, normalize, parent, resolve } from "./paths.ts";
import { Remote, type RemoteEntry } from "./remote.ts";
import { trusted } from "./trusted.ts";

type Kind = "file" | "folder" | "symlink";

interface Seen {
  kind: Kind;
  size: number;
  mode: number;
  mtime: Date;
  target?: string;
}

type ReadFileOptions = Parameters<IFileSystem["readFile"]>[1];
type WriteFileOptions = Parameters<IFileSystem["writeFile"]>[2];
type DirentEntry = Awaited<ReturnType<NonNullable<IFileSystem["readdirWithFileTypes"]>>>[number];

const SYMLINK_DEPTH = 40;

export interface Served {
  folder: string;
  at: string;
}

export class SkywakeFs implements IFileSystem {
  readonly #changes = new Changes();
  readonly #remote: Remote;
  readonly disk: Disk;

  constructor(disk: Disk) {
    this.disk = disk;
    this.#remote = new Remote(disk);
  }

  get pending(): number {
    return this.#changes.size;
  }

  head(): Promise<string> {
    return this.#remote.head();
  }

  async commit(message: string): Promise<string | null> {
    if (this.#changes.size === 0) return null;
    const changes = await changesOf(this.#changes, this.#remote);
    const { commit: head } = await trusted(() => this.disk.commit(changes, message));
    this.#changes.clear();
    this.#remote.moved(head);
    return head;
  }

  discard() {
    this.#changes.clear();
  }

  async served(path: string): Promise<Served | null> {
    const at = normalize(path);
    if (this.#changes.touches(at)) return null;
    const located = this.#changes.locate(at);
    if (!located || !("base" in located) || located.base !== at) return null;
    const entry = await this.#remote.stat(at);
    if (entry?.kind !== "folder") return null;
    return { folder: at, at: await this.#remote.head() };
  }

  resolvePath(base: string, path: string): string {
    return resolve(base, path);
  }

  getAllPaths(): string[] {
    return this.#changes.paths();
  }

  async exists(path: string): Promise<boolean> {
    return (await this.#lookup(normalize(path))) !== null;
  }

  async stat(path: string): Promise<FsStat> {
    return toStat((await this.#follow(normalize(path), "stat")).seen);
  }

  async lstat(path: string): Promise<FsStat> {
    const at = normalize(path);
    return toStat((await this.#lookup(at)) ?? fail("ENOENT", "lstat", at));
  }

  async realpath(path: string): Promise<string> {
    return (await this.#follow(normalize(path), "realpath")).path;
  }

  async readlink(path: string): Promise<string> {
    const at = normalize(path);
    const seen = (await this.#lookup(at)) ?? fail("ENOENT", "readlink", at);
    return seen.target ?? fail("ENOTSUP", "readlink", at);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const { path: at, seen } = await this.#follow(normalize(path), "open");
    if (seen.kind === "folder") fail("EISDIR", "read", at);
    const located = this.#changes.locate(at);
    if (located && "pending" in located && located.pending.kind === "file") {
      return located.pending.bytes;
    }
    if (located && "base" in located) return this.#remote.read(located.base);
    return fail("ENOENT", "open", at);
  }

  async readFile(path: string, options?: ReadFileOptions): Promise<string> {
    const encoding = (typeof options === "string" ? options : options?.encoding) ?? "utf8";
    return Buffer.from(await this.readFileBuffer(path)).toString(encoding);
  }

  async writeFile(path: string, content: FileContent, options?: WriteFileOptions): Promise<void> {
    const at = normalize(path);
    const existing = await this.#lookup(at);
    if (existing?.kind === "folder") fail("EISDIR", "open", at);
    await this.#requireFolder(parent(at), "open");
    const bytes = encode(content, options);
    const mode = existing?.kind === "file" ? existing.mode : 0o644;
    this.#changes.set(at, { kind: "file", bytes, mode, mtime: new Date() });
  }

  async appendFile(path: string, content: FileContent, options?: WriteFileOptions): Promise<void> {
    const at = normalize(path);
    const before = (await this.#lookup(at)) ? await this.readFileBuffer(at) : new Uint8Array();
    await this.writeFile(at, Buffer.concat([before, encode(content, options)]));
  }

  async mkdir(path: string, options: MkdirOptions = {}): Promise<void> {
    const at = normalize(path);
    const existing = await this.#lookup(at);
    if (existing) {
      if (existing.kind === "folder" && options.recursive) return;
      fail("EEXIST", "mkdir", at);
    }
    const above = await this.#lookup(parent(at));
    if (!above && options.recursive) await this.mkdir(parent(at), options);
    else if (!above) fail("ENOENT", "mkdir", at);
    else if (above.kind !== "folder") fail("ENOTDIR", "mkdir", at);
    this.#changes.set(at, { kind: "folder", mode: 0o755, mtime: new Date() });
  }

  async readdir(path: string): Promise<string[]> {
    return [...(await this.#children(normalize(path))).keys()].sort();
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const children = await this.#children(normalize(path));
    return [...children]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, kind]) => ({
        name,
        isFile: kind === "file",
        isDirectory: kind === "folder",
        isSymbolicLink: kind === "symlink",
      }));
  }

  async rm(path: string, options: RmOptions = {}): Promise<void> {
    const at = normalize(path);
    const seen = await this.#lookup(at);
    if (!seen) {
      if (options.force) return;
      fail("ENOENT", "rm", at);
    }
    if (seen.kind === "folder" && !options.recursive && (await this.#children(at)).size > 0) {
      fail("ENOTEMPTY", "rm", at);
    }
    this.#changes.set(at, { kind: "gone" });
  }

  async cp(source: string, destination: string, options: CpOptions = {}): Promise<void> {
    const from = normalize(source);
    const to = normalize(destination);
    const seen = (await this.#lookup(from)) ?? fail("ENOENT", "cp", from);
    if (seen.kind === "folder" && !options.recursive) fail("EISDIR", "cp", from);
    await this.#requireFolder(parent(to), "cp");
    const located = this.#changes.locate(from);
    if (located && "base" in located && !this.#changes.touches(from)) {
      this.#changes.set(to, { kind: "copy", from: located.base });
    } else {
      await this.#copyOut(from, to, seen);
    }
  }

  async mv(source: string, destination: string): Promise<void> {
    await this.cp(source, destination, { recursive: true });
    await this.rm(source, { recursive: true });
  }

  async link(existing: string, path: string): Promise<void> {
    await this.cp(existing, path);
  }

  async symlink(_target: string, path: string): Promise<void> {
    fail("ENOTSUP", "symlink", normalize(path));
  }

  async chmod(path: string, mode: number): Promise<void> {
    const at = normalize(path);
    const seen = (await this.#lookup(at)) ?? fail("ENOENT", "chmod", at);
    if (seen.kind !== "file") return;
    const bytes = await this.readFileBuffer(at);
    this.#changes.set(at, { kind: "file", bytes, mode, mtime: new Date() });
  }

  async utimes(): Promise<void> {}

  async #lookup(path: string): Promise<Seen | null> {
    const located = this.#changes.locate(path);
    if (!located) return null;
    if ("pending" in located) return seenPending(located.pending);
    const entry = await this.#remote.stat(located.base);
    return entry && seenRemote(entry);
  }

  async #follow(path: string, operation: string): Promise<{ path: string; seen: Seen }> {
    let at = path;
    for (let depth = 0; depth <= SYMLINK_DEPTH; depth++) {
      const seen = (await this.#lookup(at)) ?? fail("ENOENT", operation, path);
      if (seen.kind !== "symlink" || seen.target === undefined) return { path: at, seen };
      at = resolve(parent(at), seen.target);
    }
    return fail("ELOOP", operation, path);
  }

  async #requireFolder(path: string, operation: string) {
    const seen = (await this.#lookup(path)) ?? fail("ENOENT", operation, path);
    if (seen.kind !== "folder") fail("ENOTDIR", operation, path);
  }

  async #children(path: string): Promise<Map<string, Kind>> {
    const { path: at, seen } = await this.#follow(path, "scandir");
    if (seen.kind !== "folder") fail("ENOTDIR", "scandir", at);
    const children = new Map<string, Kind>();
    const located = this.#changes.locate(at);
    if (located && "base" in located) {
      for (const [name, entry] of await this.#remote.list(located.base)) {
        children.set(name, entry.kind);
      }
    }
    for (const [name, entry] of this.#changes.children(at)) {
      if (entry.kind === "gone") children.delete(name);
      else {
        const kind = (await this.#lookup(join(at, name)))?.kind;
        if (kind) children.set(name, kind);
      }
    }
    return children;
  }

  async #copyOut(from: string, to: string, seen: Seen): Promise<void> {
    if (seen.kind === "file") {
      const bytes = await this.readFileBuffer(from);
      this.#changes.set(to, { kind: "file", bytes, mode: seen.mode, mtime: new Date() });
      return;
    }
    this.#changes.set(to, { kind: "folder", mode: seen.mode, mtime: new Date() });
    for (const name of (await this.#children(from)).keys()) {
      const child = await this.#lookup(join(from, name));
      if (child) await this.#copyOut(join(from, name), join(to, name), child);
    }
  }
}

function seenPending(entry: Held): Seen {
  if (entry.kind === "folder")
    return { kind: "folder", size: 0, mode: entry.mode, mtime: entry.mtime };
  return { kind: "file", size: entry.bytes.length, mode: entry.mode, mtime: entry.mtime };
}

function seenRemote(entry: RemoteEntry): Seen {
  const mode = entry.kind === "folder" ? 0o755 : entry.kind === "symlink" ? 0o777 : 0o644;
  return {
    kind: entry.kind,
    size: entry.size,
    mode: entry.executable ? mode | 0o111 : mode,
    mtime: new Date(entry.modified),
    target: entry.target,
  };
}

function toStat(seen: Seen): FsStat {
  return {
    isFile: seen.kind === "file",
    isDirectory: seen.kind === "folder",
    isSymbolicLink: seen.kind === "symlink",
    mode: seen.mode,
    size: seen.size,
    mtime: seen.mtime,
  };
}

function encode(content: FileContent, options?: WriteFileOptions): Uint8Array {
  if (typeof content !== "string") return content;
  const encoding = (typeof options === "string" ? options : options?.encoding) ?? "utf8";
  return Buffer.from(content, encoding);
}
