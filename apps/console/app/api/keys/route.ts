import { skywake } from "@/server/api";
import { caller } from "@/server/caller";

// API keys for agents, made and removed through skywake-api. Keys are not
// synced: only their owner should see the secret, and only once.
async function forward(request: Request, path: string, init: RequestInit = {}) {
  const who = await caller(request.headers);
  if (!who) return new Response("sign in first", { status: 401 });
  const response = await skywake(who, path, init);
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request: Request) {
  return forward(request, "/keys");
}

export async function POST(request: Request) {
  return forward(request, "/keys", { method: "POST", body: await request.text() });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return forward(request, `/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
}
