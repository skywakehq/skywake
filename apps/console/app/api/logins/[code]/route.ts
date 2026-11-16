import { skywake } from "@/server/api";
import { caller } from "@/server/caller";

type Params = { params: Promise<{ code: string }> };

async function forward(request: Request, params: Params["params"], init: RequestInit = {}) {
  const who = await caller(request.headers);
  if (!who) return Response.json({ error: "sign in first" }, { status: 401 });
  const { code } = await params;
  const response = await skywake(who, `/logins/${encodeURIComponent(code)}`, init);
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request: Request, { params }: Params) {
  return forward(request, params);
}

export async function POST(request: Request, { params }: Params) {
  return forward(request, params, { method: "POST", body: await request.text() });
}
