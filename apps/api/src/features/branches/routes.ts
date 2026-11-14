import { branches as routes } from "@skywake/contract";
import { EngineError, type Engine } from "@skywake/engine";

import { note } from "../../audit/note.ts";
import type { Feature } from "../../http/context.ts";
import { conflict, isMissing, notFound } from "../../http/errors.ts";
import { changeable, readable } from "../../http/request.ts";
import * as commits from "../history/commits.ts";
import { dropIndex, forkIndex } from "../links/routes.ts";
import * as links from "../links/queries.ts";
import * as branches from "./queries.ts";
import { protect, whileWritable } from "./protection.ts";

const LOST = new Set(["unavailable", "internal"]);

/** Whether `head` is what a new branch from `source` starts at: the same commit, or an empty one. */
async function isFork(engine: Engine, head: string, source: string | null) {
  if (source) return head === source;
  const { commit, changes } = await engine.commit(head);
  return commit.parent === undefined && changes.length === 0;
}

/** Where `branch` and the branch it forked from last met; null once that one is gone. */
async function baseOf(engine: Engine, branch: string, source: string) {
  try {
    return await engine.mergeBase(branch, source);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export const branchesFeature: Feature = {
  register(api) {
    api.openapi(routes.listBranches, async (c) => {
      const ns = await readable(c, c.req.valid("param").namespace);
      return c.json(
        await branches.list(c.var.services.db, ns.org, ns.name, c.req.valid("query")),
        200,
      );
    });

    api.openapi(routes.createBranch, async (c) => {
      const { caller, ns } = await changeable(c, c.req.valid("param").namespace, "write");
      const { name, from, at, withIndex } = c.req.valid("json");
      const { db } = c.var.services;
      const ref = { org: ns.org, namespace: ns.name, name };
      if (withIndex && !(await links.find(db, ns.org, ns.name))) {
        throw conflict(`namespace \`${ns.name}\` has no index to fork; link one first`);
      }
      // The head the new branch must have; none for an empty branch.
      const source = at ?? (from ? await ns.engine.head(from) : null);
      if (!(await branches.add(db, ref, from ?? null)))
        throw conflict(`branch \`${name}\` already exists`);
      let head: string;
      try {
        // Fork from the head read above, not the source's name, so a commit to
        // the source meanwhile can't make our own branch look like someone else's.
        head = source ? await ns.engine.forkAt(name, source) : await ns.engine.createBranch(name);
      } catch (error) {
        // The create may have landed even though its answer was lost. Keep the
        // branch then, but only if it is surely ours: store credentials can
        // write a ref too, so a branch with another head is someone else's.
        const lost = error instanceof EngineError && LOST.has(error.kind);
        const found = lost ? await ns.engine.head(name).catch((reason: unknown) => reason) : null;
        if (typeof found === "string" && (await isFork(ns.engine, found, source))) {
          head = found;
        } else {
          // Not knowing is no proof it is missing, so the row stays then.
          if (!lost || typeof found === "string" || isMissing(found)) {
            await branches.remove(db, ref);
          }
          throw typeof found === "string" ? conflict(`branch \`${name}\` already exists`) : error;
        }
      }
      note(c, { details: { branch: name, head } });
      if (withIndex) await forkIndex(c, ns.org, ns.name, name, from ?? null, source);
      await commits.record(db, ns.engine, ref, head, caller.actor, false);
      return c.json({ head }, 201);
    });

    api.openapi(routes.getBranch, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const ns = await readable(c, namespace);
      const found = await branches.find(c.var.services.db, {
        org: ns.org,
        namespace: ns.name,
        name: branch,
      });
      if (!found) throw notFound(`branch \`${branch}\``);
      const [head, base] = await Promise.all([
        ns.engine.head(branch),
        found.forked_from ? baseOf(ns.engine, branch, found.forked_from) : null,
      ]);
      return c.json({ ...found, head, base }, 200);
    });

    api.openapi(routes.updateBranch, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { ns } = await changeable(c, namespace, "admin");
      const { protected: value } = c.req.valid("json");
      const ref = { org: ns.org, namespace: ns.name, name: branch };
      const { db } = c.var.services;
      const changed = value ? await protect(db, ref) : await branches.protect(db, ref, false);
      if (!changed) throw notFound(`branch \`${branch}\``);
      note(c, { details: { protected: value } });
      return c.body(null, 204);
    });

    api.openapi(routes.deleteBranch, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { ns } = await changeable(c, namespace, "write");
      const { db } = c.var.services;
      const ref = { org: ns.org, namespace: ns.name, name: branch };
      if (!(await branches.find(db, ref))) throw notFound(`branch \`${branch}\``);
      await whileWritable(db, ns, branch, async () => {
        try {
          await ns.engine.deleteBranch(branch);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      });
      await branches.remove(db, ref);
      await dropIndex(c, ns.org, ns.name, branch);
      return c.body(null, 204);
    });
  },
};
