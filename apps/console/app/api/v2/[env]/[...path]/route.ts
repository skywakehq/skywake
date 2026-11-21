import { skywakeV2 } from "@/server/api";
import { caller } from "@/server/caller";

type Params = RouteContext<"/api/v2/[env]/[...path]">;

const ALLOWED: Record<string, RegExp> = {
  GET: /^disks(\/[^/]+)?$/,
  PATCH: /^disks\/[^/]+$/,
  POST: /^disks\/[^/]+\/query$/,
};

async function forward(request: Request, { params }: Params) {
  const who = await caller(request.headers);
  if (!who) return Response.json({ error: { message: "sign in first" } }, { status: 401 });
  const { env, path } = await params;
  if (!ALLOWED[request.method]?.test(path.join("/"))) {
    return Response.json({ error: { message: "not allowed here" } }, { status: 400 });
  }
  const search = new URL(request.url).search;
  const body = request.method === "GET" ? undefined : await request.text();
  const response = await skywakeV2(
    who,
    env,
    `/${path.map(encodeURIComponent).join("/")}${search}`,
    { method: request.method, body },
  );
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}

export { forward as GET, forward as PATCH, forward as POST };
