// The calls the file manager makes, through the console's proxy.

import { apiPath } from "@/lib/paths";
import { withBase } from "@/lib/zone";

export type Entry = {
  name: string;
  kind: "file" | "folder" | "symlink";
  size: number;
  modified?: number;
  target?: string;
};
export type Listing = Entry & { entries: Entry[] };

export type Change =
  | { path: string; delete: true }
  | { path: string; text: string }
  | { path: string; parts: string[] }
  | { path: string; folder: true }
  | { path: string; from: { path: string; at?: string } };

/** One version of a file. `time` is in seconds; `size` is null where the commit deleted it. */
export type Version = {
  hash: string;
  message: string;
  time: number;
  session: string | null;
  size: number | null;
};

const files = (branch: string) => `branches/${encodeURIComponent(branch)}/files`;

export const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export const listUrl = (ns: string, branch: string, path: string, at?: string | null) =>
  apiPath(ns, `${files(branch)}?${new URLSearchParams({ path, ...(at ? { at } : {}) })}`);

export const contentUrl = (
  ns: string,
  branch: string,
  path: string,
  options: { at?: string | null; download?: boolean } = {},
) =>
  apiPath(
    ns,
    `${files(branch)}/content?${new URLSearchParams({
      path,
      ...(options.at ? { at: options.at } : {}),
      ...(options.download ? { download: "1" } : {}),
    })}`,
  );

export const historyUrl = (ns: string, branch: string, path: string) =>
  apiPath(ns, `${files(branch)}/history?${new URLSearchParams({ path })}`);

export const zipUrl = (ns: string, branch: string, paths: string[], at?: string | null) =>
  withBase(
    `/api/zip?${new URLSearchParams([
      ["ns", ns],
      ["branch", branch],
      ...(at ? [["at", at]] : []),
      ...paths.map((path) => ["path", path]),
    ])}`,
  );

async function failure(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text).error ?? response.statusText;
  } catch {
    return text || response.statusText;
  }
}

/** Lands `changes` on `branch` as one commit. */
export async function commit(ns: string, branch: string, message: string, changes: Change[]) {
  const response = await fetch(apiPath(ns, `branches/${encodeURIComponent(branch)}/commits`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, changes }),
  });
  if (!response.ok)
    throw Object.assign(new Error(await failure(response)), { status: response.status });
  // `changed` is false when the files matched what was there, so no commit was made.
  return (await response.json()) as { head: string; changed: boolean };
}

export { failure };

/** Starts a download without leaving the page. */
export function download(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}
