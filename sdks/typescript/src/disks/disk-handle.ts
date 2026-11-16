import type { Schemas } from "../core/api.js";
import { NotFound } from "../core/errors.js";
import { filePath, segment, type Http } from "../core/http.js";
import { collect, pages, type Page } from "../core/paging.js";
import { changeOf, type Content, type FileChange } from "./changes.js";
import { download, upload, type FolderOptions } from "./folders.js";

export const MAIN = "main";

export type Entry = Schemas["Entry"];
export type Commit = Schemas["Commit"];
export type Committed = Schemas["CommittedV2"];
export type Change = Schemas["Change"];
export type Match = Schemas["MatchV2"];
export type Found = Schemas["Found"];
export type FileHit = Schemas["FileHit"];
export type DiskInfo = Schemas["DiskInfo"];
export type DiskBranch = Schemas["DiskBranch"];
export type Branch = Schemas["Branch"];
export type Merged = Schemas["DiskMerged"];
export type Visibility = Schemas["Visibility"];

export interface ReadOptions {
  at?: string;
  offset?: number;
  length?: number;
}

export interface WriteOptions {
  message?: string;
  executable?: boolean;
}

export interface ListOptions {
  recursive?: boolean;
  at?: string;
}

export interface GrepOptions {
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  limit?: number;
  at?: string;
}

export interface FindOptions {
  path?: string;
  kind?: "any" | "files" | "folders";
  limit?: number;
  at?: string;
}

export interface MergeOptions {
  message?: string;
  dryRun?: boolean;
  prefer?: "ours" | "theirs";
}

export interface DiskSettings {
  search?: boolean;
  visibility?: Visibility;
}

const parentOf = (path: string) => path.replace(/\/?[^/]*\/*$/, "");
const clean = (path: string) => path.replace(/^\/+|\/+$/g, "");

export class Disk {
  readonly name: string;
  readonly branch: string;
  readonly #http: Http;

  constructor(http: Http, name: string, branch: string = MAIN) {
    this.#http = http;
    this.name = name;
    this.branch = branch;
  }

  get #path() {
    return `/disks/${segment(this.name)}`;
  }

  get #on() {
    return { branch: this.branch };
  }

  on(branch: string): Disk {
    return new Disk(this.#http, this.name, branch);
  }

  read(path: string, options?: ReadOptions & { as?: "text" }): Promise<string>;
  read(path: string, options: ReadOptions & { as: "bytes" }): Promise<Uint8Array>;
  read(path: string, options: ReadOptions & { as: "stream" }): Promise<ReadableStream<Uint8Array>>;
  async read(
    path: string,
    options: ReadOptions & { as?: "text" | "bytes" | "stream" } = {},
  ): Promise<string | Uint8Array | ReadableStream<Uint8Array>> {
    const { as = "text", ...range } = options;
    const response = await this.#http.raw("GET", `${this.#path}/files/${filePath(path)}`, {
      query: { ...this.#on, ...range },
    });
    if (as === "stream") return response.body ?? new Blob([]).stream();
    if (as === "bytes") return new Uint8Array(await response.arrayBuffer());
    return response.text();
  }

  write(path: string, content: Content, options?: WriteOptions): Promise<Committed>;
  write(files: Record<string, Content>, options?: WriteOptions): Promise<Committed>;
  async write(
    target: string | Record<string, Content>,
    content?: Content | WriteOptions,
    options: WriteOptions = {},
  ): Promise<Committed> {
    const files = typeof target === "string" ? { [target]: content as Content } : target;
    const asked = typeof target === "string" ? options : ((content ?? {}) as WriteOptions);
    const changes = await Promise.all(
      Object.entries(files).map(([path, body]) =>
        changeOf(clean(path), body, (bytes) => this.part(bytes), asked.executable),
      ),
    );
    return this.commit(changes, asked.message);
  }

  delete(paths: string | string[], options: { message?: string } = {}): Promise<Committed> {
    const all = Array.isArray(paths) ? paths : [paths];
    return this.commit(
      all.map((path) => ({ path: clean(path), delete: true })),
      options.message,
    );
  }

  move(from: string, to: string, options: { message?: string } = {}): Promise<Committed> {
    return this.commit(
      [
        { path: clean(to), from: { path: clean(from) } },
        { path: clean(from), delete: true },
      ],
      options.message ?? `Move ${clean(from)} to ${clean(to)}`,
    );
  }

  commit(changes: FileChange[], message?: string): Promise<Committed> {
    return this.#http.post(`${this.#path}/commits`, { changes, message, ...this.#on });
  }

  async part(bytes: Uint8Array): Promise<string> {
    const uploaded = await this.#http.call<Schemas["Uploaded"]>("POST", `${this.#path}/uploads`, {
      bytes,
    });
    return uploaded.part;
  }

  entries(path = "", options: ListOptions = {}): AsyncGenerator<Entry> {
    const { recursive, at } = options;
    return pages((cursor) =>
      this.#http.get<Page<Entry>>(`${this.#path}/files`, {
        path: clean(path),
        recursive: recursive ? "true" : undefined,
        at,
        cursor,
        limit: 1000,
        ...this.#on,
      }),
    );
  }

  list(path = "", options: ListOptions = {}): Promise<Entry[]> {
    return collect(this.entries(path, options));
  }

  async *walk(path = "", options: { at?: string } = {}): AsyncGenerator<Entry> {
    for await (const entry of this.entries(path, options)) {
      yield entry;
      if (entry.kind === "folder") yield* this.walk(entry.path, options);
    }
  }

  async stat(path: string, options: { at?: string } = {}): Promise<Entry | null> {
    const target = clean(path);
    if (target === "") {
      return { path: "", kind: "folder", size: 0, modified: null, executable: false };
    }
    try {
      for await (const entry of this.entries(parentOf(target), options)) {
        if (entry.path === target) return entry;
        if (entry.path > target) return null;
      }
    } catch (error) {
      if (!(error instanceof NotFound)) throw error;
      await this.info();
    }
    return null;
  }

  async exists(path: string, options: { at?: string } = {}): Promise<boolean> {
    return (await this.stat(path, options)) !== null;
  }

  async grep(pattern: string, options: GrepOptions = {}): Promise<Match[]> {
    const { ignoreCase, ...rest } = options;
    const body = { pattern, ...rest, ignore_case: ignoreCase, ...this.#on };
    return (await this.#http.post<Page<Match>>(`${this.#path}/grep`, body)).data;
  }

  async find(glob: string, options: FindOptions = {}): Promise<Found[]> {
    const body = { glob, ...options, ...this.#on };
    return (await this.#http.post<Page<Found>>(`${this.#path}/find`, body)).data;
  }

  async query(text: string, options: { limit?: number; path?: string } = {}): Promise<FileHit[]> {
    const body = { text, ...options, ...this.#on };
    return (await this.#http.post<Page<FileHit>>(`${this.#path}/query`, body)).data;
  }

  async fork(name: string, options: { at?: string } = {}): Promise<Disk> {
    await this.#http.post<Branch>(`${this.#path}/branches`, {
      name,
      from: this.branch,
      ...options,
    });
    return this.on(name);
  }

  mergeInto(into: string = MAIN, options: MergeOptions = {}): Promise<Merged> {
    const { dryRun, ...rest } = options;
    return this.#http.post(`${this.#path}/merges`, {
      from: this.branch,
      into,
      dry_run: dryRun,
      ...rest,
    });
  }

  async destroy(): Promise<void> {
    if (this.branch === MAIN) await this.#http.delete(this.#path);
    else await this.#http.delete(`${this.#path}/branches/${segment(this.branch)}`);
  }

  branches(): Promise<Branch[]> {
    return collect(
      pages((cursor) => this.#http.get<Page<Branch>>(`${this.#path}/branches`, { cursor })),
    );
  }

  async head(): Promise<string | null> {
    const branch = await this.#http.get<DiskBranch>(
      `${this.#path}/branches/${segment(this.branch)}`,
    );
    return branch.head;
  }

  log(options: { path?: string; limit?: number } = {}): AsyncGenerator<Commit> {
    return pages((cursor) =>
      this.#http.get<Page<Commit>>(`${this.#path}/commits`, {
        ...options,
        cursor,
        ...this.#on,
      }),
    );
  }

  diff(against: string): Promise<Change[]> {
    return collect(
      pages((cursor) =>
        this.#http.get<Page<Change>>(`${this.#path}/diff`, { against, cursor, ...this.#on }),
      ),
    );
  }

  revert(commit: string, options: { message?: string } = {}): Promise<Committed> {
    return this.#http.post(`${this.#path}/revert`, { commit, ...options, ...this.#on });
  }

  async restore(to: string | Date): Promise<Committed> {
    const commit = to instanceof Date ? await this.#commitAt(to) : to;
    return this.#http.post(`${this.#path}/restore`, { to: commit, ...this.#on });
  }

  async #commitAt(time: Date): Promise<string> {
    for await (const commit of this.log({ limit: 1000 })) {
      if (new Date(commit.created) <= time) return commit.id;
    }
    throw new RangeError(
      `disk \`${this.name}\` has no commit from ${time.toISOString()} or before`,
    );
  }

  download(dir: string, options: FolderOptions & { at?: string } = {}): Promise<string | null> {
    return download(this, dir, options);
  }

  upload(dir: string, options: FolderOptions & { message?: string } = {}): Promise<string | null> {
    return upload(this, dir, options);
  }

  info(): Promise<DiskInfo> {
    return this.#http.get(this.#path);
  }

  configure(settings: DiskSettings): Promise<DiskInfo> {
    return this.#http.patch(this.#path, settings);
  }
}
