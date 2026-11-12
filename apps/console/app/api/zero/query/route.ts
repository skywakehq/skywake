import { mustGetQuery } from "@rocicorp/zero";
import { handleQueryRequest } from "@rocicorp/zero/server";
import { caller } from "@/server/caller";
import { queries } from "@/zero/queries";
import { schema } from "@/zero/schema";

// zero-cache asks here what each query means for this person. The cookie
// it forwards says who they are and which organization they are in.
export async function POST(request: Request) {
  const who = await caller(request.headers, { forwarded: true });
  if (!who) return new Response("sign in first", { status: 401 });
  const ctx = { userID: who.userID, org: who.org, role: who.role };
  const result = await handleQueryRequest({
    handler: (name, args) => mustGetQuery(queries, name).fn({ args, ctx }),
    schema,
    request,
    userID: who.userID,
  });
  return Response.json(result);
}
