import { skywakeV2 } from "@/server/api";
import { caller } from "@/server/caller";

const ALLOWED = /^indexes(\/[^/]+)?$/;

/** Lists an environment's indexes, or reads one of them, or nothing else. */
export async function GET(request: Request, { params }: RouteContext<"/api/v2/[env]/[...path]">) {
  const who = await caller(request.headers);
  if (!who) return Response.json({ error: { message: "sign in first" } }, { status: 401 });
  const { env, path } = await params;
  if (!ALLOWED.test(path.join("/"))) {
    return Response.json({ error: { message: "not allowed here" } }, { status: 400 });
  }
  const search = new URL(request.url).search;
  const response = await skywakeV2(who, env, `/${path.map(encodeURIComponent).join("/")}${search}`);
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
