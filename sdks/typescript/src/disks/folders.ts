import { batches } from "../core/batches.js";
import { CONCURRENCY, mapConcurrently } from "../core/concurrency.js";
import { changeOf, COMMIT, INLINE_MAX, PART_MAX, weight, type FileChange } from "./changes.js";
import type { Disk, Entry } from "./disk-handle.js";

export interface FolderOptions {
  concurrency?: number;
}

export async function download(
  disk: Disk,
  dir: string,
  options: FolderOptions & { at?: string } = {},
): Promise<string | null> {
  const { fs, path } = await node();
  const at = options.at ?? (await disk.head());
  const root = path.resolve(dir);
  await fs.mkdir(root, { recursive: true });
  if (!at) return null;
  const local = (name: string) => {
    const file = path.resolve(root, ...name.split("/"));
    if (!file.startsWith(root + path.sep)) throw new Error(`\`${name}\` is outside ${root}`);
    return file;
  };
  const entries: Entry[] = [];
  for await (const entry of disk.walk("", { at })) entries.push(entry);
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
    await fs.writeFile(file, await disk.read(entry.path, { at, as: "stream" }));
    if (entry.executable) await fs.chmod(file, 0o755);
  });
  return at;
}

export async function upload(
  disk: Disk,
  dir: string,
  options: FolderOptions & { message?: string } = {},
): Promise<string | null> {
  const { fs, path } = await node();
  const files = await localFiles(fs, path, path.resolve(dir));
  let head: string | null = null;
  for (const batch of batches(files, COMMIT, (file) => weight(file.path, file.size))) {
    const changes = await mapConcurrently(batch, options.concurrency ?? CONCURRENCY, (file) =>
      changeFrom(disk, fs, file),
    );
    head = (await disk.commit(changes, options.message)).commit;
  }
  return head ?? (await disk.head());
}

interface LocalFile {
  path: string;
  file: string;
  size: number;
  executable: boolean;
}

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

async function changeFrom(disk: Disk, fs: Fs, file: LocalFile): Promise<FileChange> {
  const { path, executable } = file;
  if (file.size <= INLINE_MAX) {
    return changeOf(path, await fs.readFile(file.file), (bytes) => disk.part(bytes), executable);
  }
  const handle = await fs.open(file.file, "r");
  try {
    const parts: string[] = [];
    for (let offset = 0; offset < file.size; offset += PART_MAX) {
      const bytes = new Uint8Array(Math.min(PART_MAX, file.size - offset));
      await handle.read(bytes, 0, bytes.length, offset);
      parts.push(await disk.part(bytes));
    }
    return { path, executable, parts };
  } finally {
    await handle.close();
  }
}

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
  const [fs, path] = await Promise.all([
    import("node:fs/promises" as string),
    import("node:path" as string),
  ]);
  return { fs: fs as Fs, path: path as Path };
}
