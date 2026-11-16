import type { FileChange } from "@skywake/sdk";

import type { Changes, Pending } from "./changes.ts";
import { remote } from "./paths.ts";
import type { Remote } from "./remote.ts";

const utf8 = new TextDecoder("utf-8", { fatal: true });

export async function changesOf(changes: Changes, base: Remote): Promise<FileChange[]> {
  const at = await base.head();
  const planned: FileChange[] = [];
  for (const [path, entry] of changes.sorted()) {
    const target = remote(path);
    const occupied = await occupiedBefore(changes, base, path);
    if (entry.kind === "gone") {
      if (occupied) planned.push({ path: target, delete: true });
      continue;
    }
    if (entry.kind === "folder" && occupied) planned.push({ path: target, delete: true });
    planned.push(changeOf(target, entry, at));
  }
  return planned;
}

async function occupiedBefore(changes: Changes, base: Remote, path: string): Promise<boolean> {
  const located = changes.beneath(path);
  return located !== null && "base" in located && (await base.stat(located.base)) !== null;
}

function changeOf(path: string, entry: Exclude<Pending, { kind: "gone" }>, at: string): FileChange {
  switch (entry.kind) {
    case "folder":
      return { path, folder: true };
    case "copy":
      return { path, from: { path: remote(entry.from), at } };
    case "file":
      return { path, ...encoded(entry.bytes), executable: (entry.mode & 0o111) !== 0 };
  }
}

function encoded(bytes: Uint8Array): { text: string } | { base64: string } {
  try {
    return { text: utf8.decode(bytes) };
  } catch {
    return { base64: Buffer.from(bytes).toString("base64") };
  }
}
