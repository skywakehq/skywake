import { part, skywake } from "@/server/api";
import { caller } from "@/server/caller";

// Where the organization may be called from. skywake-api checks the caller is
// an admin, and refuses a list that would lock them out.
async function forward(request: Request, init: RequestInit = {}) {
  const who = await caller(request.headers);
  if (!who) return Response.json({ error: "sign in first" }, { status: 401 });
  const response = await skywake(who, `/orgs/${part(who.org)}/ip-allowlist`, init);
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request: Request) {
  return forward(request);
}

export async function PUT(request: Request) {
  return forward(request, { method: "PUT", body: await request.text() });
}
