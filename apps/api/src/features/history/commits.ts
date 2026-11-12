import type { Engine } from "@skywake/engine";
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { branches, commits } from "../../db/schema.ts";
import type { BranchRef } from "../branches/queries.ts";

export async function record(
  db: Db,
  engine: Engine,
  ref: BranchRef,
  head: string,
  actor: string,
  newCommit: boolean,
) {
  const commit = newCommit ? await engine.commit(head) : null;
  await db.transaction(async (tx) => {
    await tx
      .update(branches)
      .set({ head, updated: new Date() })
      .where(
        and(
          eq(branches.org, ref.org),
          eq(branches.namespace, ref.namespace),
          eq(branches.name, ref.name),
        ),
      );
    if (!commit) return;
    const session = commit.commit.session ?? null;
    await tx
      .insert(commits)
      .values({
        org: ref.org,
        namespace: ref.namespace,
        branch: ref.name,
        hash: head,
        parent: commit.commit.parent ?? null,
        message: commit.commit.message,
        session,
        merged: commit.commit.merged ?? null,
        actor,
        agent: session && sql`(SELECT label FROM api.sessions WHERE id = ${session})`,
        changes: commit.changes,
      })
      .onConflictDoNothing();
  });
}
