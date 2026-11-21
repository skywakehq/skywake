import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { newOrg } from "@/server/new-org";

export async function POST(request: Request) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return Response.json({ error: "sign in first" }, { status: 401 });
  const { name } = await request.json();
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "Give it a name" }, { status: 400 });
  }
  return Response.json({ id: await newOrg(requestHeaders, session.user, name.trim()) });
}
