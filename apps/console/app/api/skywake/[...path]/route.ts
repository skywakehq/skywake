import { roleIn, skywake } from "@/server/api";
import { caller } from "@/server/caller";

// Everything about search indexes goes straight to skywake-api, since Zero
// does not sync them. Other changes go through Zero.

const apiPath = (path: string[], search = "") =>
  `/${path.map(encodeURIComponent).join("/")}${search}`;

function pass(response: Response) {
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}

export async function GET(request: Request, { params }: RouteContext<"/api/skywake/[...path]">) {
  const who = await caller(request.headers);
  if (!who) return new Response("sign in first", { status: 401 });
  const { path } = await params;
  return pass(await skywake(who, apiPath(path, new URL(request.url).search)));
}

/** Writes to an index, or nothing else. */
export async function POST(request: Request, { params }: RouteContext<"/api/skywake/[...path]">) {
  const who = await caller(request.headers);
  if (!who) return new Response("sign in first", { status: 401 });
  const { path } = await params;
  if (path[0] !== "indexes") return Response.json({ error: "not allowed here" }, { status: 400 });
  const body = await request.json().catch(() => null);
  const sent = body === null ? undefined : JSON.stringify(body);
  // A copy to another organization needs the person's role there too.
  const target = path.at(-1) === "copy" ? body?.target_org : undefined;
  const role = typeof target === "string" ? await roleIn(who, target) : null;
  const orgs = role ? { [target]: role } : undefined;
  return pass(await skywake(who, apiPath(path), { method: "POST", body: sent }, orgs));
}

/** Deletes an index or one of its branches, or nothing else. */
export async function DELETE(request: Request, { params }: RouteContext<"/api/skywake/[...path]">) {
  const who = await caller(request.headers);
  if (!who) return new Response("sign in first", { status: 401 });
  const { path } = await params;
  if (path[0] !== "indexes") return Response.json({ error: "not allowed here" }, { status: 400 });
  return pass(await skywake(who, apiPath(path), { method: "DELETE" }));
}
