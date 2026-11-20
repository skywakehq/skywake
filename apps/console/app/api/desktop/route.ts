import { auth } from "@/server/auth";
import { skywake } from "@/server/api";
import { caller } from "@/server/caller";

/**
 * The person allows Skywake for Mac: the API gives a one-time code that only
 * the app's PKCE verifier can redeem. The page sends it back to the app.
 */
export async function POST(request: Request) {
  const who = await caller(request.headers);
  if (!who) return Response.json({ error: "sign in first" }, { status: 401 });
  // The other organizations go along so the app can offer to switch to them.
  const listed = await auth.api.listOrganizations({ headers: request.headers }).catch(() => []);
  const orgs = Object.fromEntries(listed.map((org) => [org.id, "member"]));
  const response = await skywake(
    who,
    "/oauth/codes",
    { method: "POST", body: await request.text() },
    orgs,
  );
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
