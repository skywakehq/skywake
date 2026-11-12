// Moving a whole branch to a local folder and back. These need Node's file
// system, which loads on first use, so the rest of the SDK still runs where
// there is none, such as a browser.

import { CONCURRENCY, mapConcurrently } from "../core/concurrency.js";
import type { Branch, FileChange } from "./branch.js";

// The API takes at most 10,000 changes in a commit, and a body of at most
// 64 MiB unless the server is set otherwise. Half of that leaves room for a
// server set lower.
const CHANGES_MAX = 10_000;
const BODY_MAX = 32 * 1024 * 1024;
// Larger files go up as raw parts, which skips base64 and keeps commits small.
const INLINE_MAX = 4 * 1024 * 1024;
// The most bytes the API takes in one uploaded part.
const PART_MAX = 16 * 1024 * 1024;

export interface CheckoutOptions {
  /** The commit to write out. The branch's head by default. */
  at?: string;
  /** How many files to read at once. 8 by default. */
  concurrency?: number;
}

export interface CommitFolderOptions {
  message: string;
  /** The session making the change. The commits record it. */
  session?: string;
  /** How many files to read at once. 8 by default. */
  concurrency?: number;
}

/** Writes every file, folder and symlink of `branch` at one commit into `dir`. */
export async function checkout(
  branch: Branch,
  dir: string,
  options: CheckoutOptions = {},
): Promise<string> {
  const { fs, path } = await node();
  // Every read uses this one commit, so commits made meanwhile do not mix in.
  const at = options.at ?? (await branch.info()).head;
  const root = path.resolve(dir);
  const local = (name: string) => {
    const file = path.resolve(root, ...name.split("/"));
    if (!file.startsWith(root + path.sep)) throw new Error(`\`${name}\` is outside ${root}`);
    return file;
  };

  await fs.mkdir(root, { recursive: true });
  const entries = [];
  for await (const entry of branch.walk("", { at })) entries.push(entry);
  // A walk lists a folder before what it holds, so parents are made first.
  for (const entry of entries) {
    if (entry.kind === "folder") await fs.mkdir(local(entry.path), { recursive: true });
  }
  const files = entries.filter((entry) => entry.kind !== "folder");
  await mapConcurrently(files, options.concurrency ?? CONCURRENCY, async (entry) => {
    const file = local(entry.path);
    if (entry.kind === "symlink") {
      await fs.rm(file, { force: true });
      await fs.symlink(entry.target ?? "", file);
      return;
    }
    // Streamed, so a large file need not fit in memory.
    await fs.writeFile(file, await branch.readStream(entry.path, { at }));
    if (entry.executable) await fs.chmod(file, 0o755);
  });
  return at;
}

/** Commits the files under `dir` to `branch`, as few commits as the API's limits allow. */
export async function commitFolder(
  branch: Branch,
  dir: string,
  options: CommitFolderOptions,
): Promise<string> {
  const { fs, path } = await node();
  const files = await localFiles(fs, path, path.resolve(dir));
  let head: string | undefined;
  for (const batch of batches(files)) {
    const changes = await mapConcurrently(batch, options.concurrency ?? CONCURRENCY, (file) =>
      change(branch, fs, file),
    );
    head = await branch.commit(options.message, changes, options.session);
  }
  return head ?? (await branch.info()).head;
}

interface LocalFile {
  /** Where it goes on the branch, with `/` between names. */
  path: string;
  /** Where it is on disk. */
  file: string;
  size: number;
  executable: boolean;
}

/** Every regular file under `root`, in path order, leaving out `.git`. */
async function localFiles(fs: Fs, path: Path, root: string): Promise<LocalFile[]> {
  const found: LocalFile[] = [];
  const visit = async (folder: string, prefix: string) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const file = path.join(folder, entry.name);
      const name = prefix + entry.name;
      if (entry.isDirectory()) {
        await visit(file, `${name}/`);
      } else if (entry.isFile()) {
        const { size, mode } = await fs.stat(file);
        found.push({ path: name, file, size, executable: (mode & 0o111) !== 0 });
      }
    }
  };
  await visit(root, "");
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Splits files into commits that stay within the API's limits. */
function batches(files: LocalFile[]): LocalFile[][] {
  const all: LocalFile[][] = [];
  let batch: LocalFile[] = [];
  let size = 0;
  for (const file of files) {
    const weight = bodySize(file);
    if (batch.length === CHANGES_MAX || (batch.length > 0 && size + weight > BODY_MAX)) {
      all.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(file);
    size += weight;
  }
  if (batch.length > 0) all.push(batch);
  return all;
}

/**
 * The most bytes a file's change can add to a commit's body. A path takes at
 * most 6 bytes a character in JSON; content is base64, or text no larger.
 */
function bodySize(file: LocalFile): number {
  const content =
    file.size > INLINE_MAX ? Math.ceil(file.size / PART_MAX) * 70 : Math.ceil(file.size / 3) * 4;
  return file.path.length * 6 + 64 + content;
}

async function change(branch: Branch, fs: Fs, file: LocalFile): Promise<FileChange> {
  const { path, executable } = file;
  if (file.size > INLINE_MAX) return { path, executable, parts: await upload(branch, fs, file) };
  const bytes = await fs.readFile(file.file);
  const text = asText(bytes);
  return text === undefined
    ? { path, executable, base64: toBase64(bytes) }
    : { path, executable, text };
}

/** Uploads a large file in parts, and returns them in order. */
async function upload(branch: Branch, fs: Fs, file: LocalFile): Promise<string[]> {
  const handle = await fs.open(file.file, "r");
  try {
    const parts: string[] = [];
    for (let offset = 0; offset < file.size; offset += PART_MAX) {
      const bytes = new Uint8Array(Math.min(PART_MAX, file.size - offset));
      await handle.read(bytes, 0, bytes.length, offset);
      parts.push(await branch.namespace.upload(bytes));
    }
    return parts;
  } finally {
    await handle.close();
  }
}

const encoder = new TextEncoder();
// Keeps a leading byte order mark, so the bytes come back exactly.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The bytes as text, when they are UTF-8. Text reads better in a commit, but
 * JSON writes some characters as several bytes, so it is used only when it is
 * no larger than base64.
 */
function asText(bytes: Uint8Array): string | undefined {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return undefined;
  }
  const json = encoder.encode(JSON.stringify(text)).length;
  return json <= Math.ceil(bytes.length / 3) * 4 + 2 ? text : undefined;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// The few Node APIs used here, typed by hand so the SDK does not need Node's types.
interface Fs {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  stat(path: string): Promise<{ size: number; mode: number }>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: AsyncIterable<Uint8Array>): Promise<void>;
  open(path: string, flags: "r"): Promise<FileHandle>;
  chmod(path: string, mode: number): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

interface Dirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

interface FileHandle {
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<unknown>;
  close(): Promise<void>;
}

interface Path {
  resolve(...paths: string[]): string;
  join(...paths: string[]): string;
  sep: string;
}

async function node(): Promise<{ fs: Fs; path: Path }> {
  // Not a literal, so bundlers for the browser leave these alone.
  const [fs, path] = await Promise.all([
    import("node:fs/promises" as string),
    import("node:path" as string),
  ]);
  return { fs: fs as Fs, path: path as Path };
}
