import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
import { SHOWN } from "../features/fleet/events.ts";
import { seesAudit } from "./roles.ts";
import { zql } from "./schema.ts";

const ns = z.object({ ns: z.string() });

// Each query is limited to the caller's organization. The server runs the
// same code with the organization from the sign-in session.
export const queries = defineQueries({
  environments: defineQuery(({ ctx }) =>
    zql.environment.where("org", ctx.org).orderBy("name", "asc"),
  ),
  namespaces: defineQuery(({ ctx }) => zql.namespace.where("org", ctx.org).orderBy("name", "asc")),
  branches: defineQuery(ns, ({ args, ctx }) =>
    zql.branch.where("org", ctx.org).where("namespace", args.ns).orderBy("name", "asc"),
  ),
  orgBranches: defineQuery(({ ctx }) => zql.branch.where("org", ctx.org)),
  orgSessions: defineQuery(({ ctx }) => zql.session.where("org", ctx.org).related("claims")),
  orgCommits: defineQuery(z.object({ limit: z.number() }), ({ args, ctx }) =>
    zql.commit.where("org", ctx.org).orderBy("at", "desc").limit(args.limit),
  ),
  commits: defineQuery(ns.extend({ limit: z.number() }), ({ args, ctx }) =>
    zql.commit
      .where("org", ctx.org)
      .where("namespace", args.ns)
      .orderBy("at", "desc")
      .limit(args.limit),
  ),
  branchCommits: defineQuery(ns.extend({ branch: z.string() }), ({ args, ctx }) =>
    zql.commit
      .where("org", ctx.org)
      .where("namespace", args.ns)
      .where("branch", args.branch)
      .orderBy("at", "desc"),
  ),
  sessions: defineQuery(ns, ({ args, ctx }) =>
    zql.session
      .where("org", ctx.org)
      .where("namespace", args.ns)
      .related("claims")
      .orderBy("created", "desc"),
  ),
  // The audit log, which only owners and admins read, as on the API. Members
  // see what changed from commits and branches instead.
  activity: defineQuery(z.object({ limit: z.number() }), ({ args, ctx }) => {
    const rows = zql.audit
      .where("org", ctx.org)
      .where("outcome", "ok")
      .where("action", "IN", SHOWN)
      .orderBy("id", "desc")
      .limit(args.limit);
    return seesAudit(ctx.role) ? rows : rows.where("id", "<", 0);
  }),
  usage: defineQuery(z.object({ since: z.number() }), ({ args, ctx }) =>
    zql.commit.where("org", ctx.org).where("at", ">=", args.since),
  ),
});
