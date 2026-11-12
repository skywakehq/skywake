import { downloadZip } from "client-zip";
import { skywake } from "@/server/api";
import { caller } from "@/server/caller";

// Folders, and several files at once, download as one zip. It streams: each
// file is read from skywake-api only when the zip reaches it.

type Entry = { name: string; kind: string; size: number; entries?: Entry[] };

export async function GET(request: Request) {
  const who = await caller(request.headers);
  if (!who) return new Response("sign in first", { status: 401 });
  const query = new URL(request.url).searchParams;
  const ns = query.get("ns");
  const branch = query.get("branch");
  const paths = query.getAll("path");
  if (!ns || !branch || !paths.length)
    return new Response("ns, branch and path are needed", { status: 400 });
  const at = query.get("at");
  const base = `/namespaces/${encodeURIComponent(ns)}/branches/${encodeURIComponent(branch)}/files`;
  const read = (path: string, suffix = "") =>
    skywake(who, `${base}${suffix}?${new URLSearchParams({ path, ...(at ? { at } : {}) })}`);

  const top = paths.length === 1 ? paths[0]!.split("/").pop()! : (ns.split("/").pop() ?? "files");
  return zip(downloadZip(files(read, paths)), top);
}

function zip(response: Response, name: string) {
  return new Response(response.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}.zip`,
    },
  });
}

async function* files(read: (path: string, suffix?: string) => Promise<Response>, paths: string[]) {
  for (const path of paths) {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    yield* walk(read, path, parent);
  }
}

async function* walk(
  read: (path: string, suffix?: string) => Promise<Response>,
  path: string,
  parent: string,
): AsyncGenerator<{ name: string; input: Response | ReadableStream; size?: number }> {
  const listing = await read(path);
  if (!listing.ok) return;
  const info = (await listing.json()) as Entry;
  const name = path.slice(parent.length);
  if (info.kind === "file") {
    const content = await read(path, "/content");
    if (content.ok && content.body) yield { name, input: content.body, size: info.size };
    return;
  }
  for (const entry of info.entries ?? []) yield* walk(read, `${path}/${entry.name}`, parent);
}
