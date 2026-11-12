import { part, skywake } from "@/server/api";
import { caller } from "@/server/caller";

const ACTIONS: Record<string, { method: string; path: string }> = {
  "POST checkout": { method: "POST", path: "/checkout" },
  "POST portal": { method: "POST", path: "/portal" },
  "PUT subscription": { method: "PUT", path: "/subscription" },
  "DELETE subscription": { method: "DELETE", path: "/subscription" },
  "POST resume": { method: "POST", path: "/subscription/resume" },
};

async function forward(request: Request, action: string[] | undefined) {
  const who = await caller(request.headers);
  if (!who) return Response.json({ error: "sign in first" }, { status: 401 });
  const name = `${request.method} ${action?.join("/") ?? ""}`.trim();
  const found =
    request.method === "GET" && !action?.length ? { method: "GET", path: "" } : ACTIONS[name];
  if (!found) return Response.json({ error: "not allowed here" }, { status: 400 });
  const body =
    found.method === "GET" || found.method === "DELETE" ? undefined : await request.text();
  const response = await skywake(who, `/orgs/${part(who.org)}/billing${found.path}`, {
    method: found.method,
    body: body || (found.method === "POST" ? "{}" : body),
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

type Context = { params: Promise<{ action?: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return forward(request, (await params).action);
}

export async function POST(request: Request, { params }: Context) {
  return forward(request, (await params).action);
}

export async function PUT(request: Request, { params }: Context) {
  return forward(request, (await params).action);
}

export async function DELETE(request: Request, { params }: Context) {
  return forward(request, (await params).action);
}
