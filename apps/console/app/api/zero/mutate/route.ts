import { mustGetMutator } from "@rocicorp/zero";
import { handleMutateRequest } from "@rocicorp/zero/server";
import { zeroNodePg } from "@rocicorp/zero/server/adapters/pg";
import { caller } from "@/server/caller";
import { pool } from "@/server/db";
import { schema } from "@/zero/schema";
import { serverMutators } from "@/server/zero-mutators";

const database = zeroNodePg(schema, pool);

export async function POST(request: Request) {
  const who = await caller(request.headers, { forwarded: true });
  if (!who) return new Response("sign in first", { status: 401 });
  const ctx = { userID: who.userID, org: who.org, role: who.role };
  const mutators = serverMutators(who);
  const result = await handleMutateRequest({
    dbProvider: database,
    handler: (transact) =>
      transact((tx, name, args) => mustGetMutator(mutators, name).fn({ args, tx, ctx })),
    request,
    userID: who.userID,
  });
  return Response.json(result);
}
