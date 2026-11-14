import { mimeOf } from "@/lib/file-kinds";
import { roleIn, skywake } from "@/server/api";
import { type Caller, caller } from "@/server/caller";

// File contents, folder listings and merge checks come from skywake-api when
// the browser asks; they are too big to sync. File uploads and commits go
// straight through too, and so does everything about search indexes, which
// Zero does not sync. Other changes go through Zero.

const apiPath = (path: string[], search = "") =>
  `/${path.map(encodeURIComponent).join("/")}${search}`;

function pass(response: Response, headers: Record<string, string> = {}, status = response.status) {
  return new Response(response.body, {
    status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      ...headers,
    },
  });
}

export async function GET(request: Request, { params }: RouteContext<"/api/skywake/[...path]">) {
  const who = await caller(request.headers);
  if (!who) return new Response("sign in first", { status: 401 });
  const { path } = await params;
  const url = new URL(request.url);
  if (path.at(-1) === "content" && path.at(-2) === "files") return content(who, path, url, request);
  return pass(await skywake(who, apiPath(path, url.search)));
}

/**
 * A file's bytes, typed by its name so the browser can show it. A `Range`
 * request reads only that part, so videos can seek and downloads can resume.
 */
async function content(who: Caller, path: string[], url: URL, request: Request) {
  const query = new URLSearchParams(url.search);
  const file = query.get("path") ?? "";
  const name = file.split("/").pop() || "file";
  const attach = query.get("download") === "1";
  query.delete("download");
  const headers: Record<string, string> = {
    "content-type": mimeOf(name),
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    // An SVG can hold scripts; sandboxed, they never run as the console.
    ...(name.toLowerCase().endsWith(".svg") ? { "content-security-policy": "sandbox" } : {}),
    "content-disposition": `${attach ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!range || query.has("offset")) {
    const response = await skywake(who, apiPath(path, `?${query}`));
    return response.ok ? pass(response, headers) : pass(response);
  }

  // A range needs the file's size, which its listing gives.
  const at = query.get("at");
  const info = await skywake(
    who,
    apiPath(path.slice(0, -1), `?${new URLSearchParams({ path: file, ...(at ? { at } : {}) })}`),
  );
  if (!info.ok) return pass(info);
  const size = Number((await info.json()).size);
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end)
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  query.set("offset", String(start));
  query.set("length", String(end - start + 1));
  const response = await skywake(who, apiPath(path, `?${query}`));
  if (!response.ok) return pass(response);
  return pass(
    response,
    {
      ...headers,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${size}`,
    },
    206,
  );
}

export async function POST(request: Request, { params }: RouteContext<"/api/skywake/[...path]">) {
  const who = await caller(request.headers);
  if (!who) return new Response("sign in first", { status: 401 });
  const { path } = await params;

  // A part of an upload: raw bytes, streamed on to the API.
  if (path.at(-1) === "uploads")
    return pass(
      await skywake(who, apiPath(path), {
        method: "POST",
        body: request.body,
        duplex: "half",
        headers: { "content-type": "application/octet-stream" },
      }),
    );

  const body = await request.json().catch(() => null);
  const allowed = path[0] === "indexes" || path.at(-1) === "commits" || body?.dry_run;
  if (!allowed) return Response.json({ error: "not allowed here" }, { status: 400 });
  const sent = body === null ? undefined : JSON.stringify(body);
  // A copy to another organization needs the person's role there too.
  const target = path.at(-1) === "copy" ? body?.target_org : undefined;
  const role = typeof target === "string" ? await roleIn(who, target) : null;
  const orgs = role ? { [target]: role } : undefined;
  return pass(await skywake(who, apiPath(path), { method: "POST", body: sent }, orgs));
}

/** A namespace's linked index: `namespaces/<ns>/index`, nothing else of a namespace. */
const isIndexLink = (path: string[]) =>
  path.length === 3 && path[0] === "namespaces" && path[2] === "index";

/** Links an index to a namespace, or nothing else. */
export async function PUT(request: Request, { params }: RouteContext<"/api/skywake/[...path]">) {
  const who = await caller(request.headers);
  if (!who) return new Response("sign in first", { status: 401 });
  const { path } = await params;
  if (!isIndexLink(path)) return Response.json({ error: "not allowed here" }, { status: 400 });
  const body = JSON.stringify(await request.json().catch(() => null));
  return pass(await skywake(who, apiPath(path), { method: "PUT", body }));
}

/** Deletes an index, one of its branches, a namespace's index link, or nothing else. */
export async function DELETE(request: Request, { params }: RouteContext<"/api/skywake/[...path]">) {
  const who = await caller(request.headers);
  if (!who) return new Response("sign in first", { status: 401 });
  const { path } = await params;
  if (path[0] !== "indexes" && !isIndexLink(path)) {
    return Response.json({ error: "not allowed here" }, { status: 400 });
  }
  return pass(await skywake(who, apiPath(path), { method: "DELETE" }));
}
