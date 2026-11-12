import { history as routes, type z } from "@skywake/contract";
import type { CommitInfo, FileEdit, MergeResolution } from "@skywake/engine";

import type { Namespace } from "../../auth/access.ts";
import { note } from "../../audit/note.ts";
import { allow, atLeast, type Caller } from "../../auth/roles.ts";
import { withLease } from "../../db/leases.ts";
import type { Ctx, Feature } from "../../http/context.ts";
import { badRequest, errorFields, isMissing } from "../../http/errors.ts";
import { pageOf, pageSize } from "../../http/page.ts";
import { changeable, readable } from "../../http/request.ts";
import { admitsFiles, filesChanged } from "../billing/require.ts";
import { whileWritable, withProtection } from "../branches/protection.ts";
import * as parts from "../files/parts.ts";
import { assertLiveSession } from "../sessions/rules.ts";
import * as commits from "./commits.ts";
import { covers, resetEdits, revertEdits } from "./undo.ts";

type Resolve = NonNullable<z.output<typeof routes.NewMerge>["resolve"]>;

const addsData = (resolution: Resolve[number]) =>
  resolution.text !== undefined ||
  resolution.base64 !== undefined ||
  resolution.parts !== undefined;

async function resolutions(c: Ctx, ns: Namespace, resolve: Resolve) {
  if (resolve.some(addsData)) await admitsFiles(c, ns.org);
  const uploaded = await parts.chunks(
    c.var.services.db,
    ns,
    resolve.flatMap((resolution) => resolution.parts ?? []),
  );
  return resolve.map((resolution): MergeResolution => {
    const { path, executable, take, text, base64 } = resolution;
    if (take) return { path, take };
    if (text !== undefined) return { path, executable, content: Buffer.from(text) };
    if (base64 !== undefined) return { path, executable, content: Buffer.from(base64, "base64") };
    if (resolution.parts) {
      const chunks = resolution.parts.flatMap((part) => {
        const found = uploaded.get(part);
        if (!found) throw badRequest(`upload part ${part} not found`);
        return found;
      });
      return { path, executable, chunks };
    }
    return { path };
  });
}

async function commitEdits(
  c: Ctx,
  { caller, ns }: { caller: Caller; ns: Namespace },
  branch: string,
  before: string,
  commit: { message: string; session?: string; edits: FileEdit[] },
) {
  const { db } = c.var.services;
  const head = await whileWritable(db, ns, branch, () =>
    ns.engine.commitFiles(branch, commit.message, commit.edits, commit.session),
  );
  if (head === before) return c.json({ head, changed: false }, 200);
  await filesChanged(c, ns.folder);
  note(c, { details: { head } });
  const ref = { org: ns.org, namespace: ns.name, name: branch };
  await commits.record(db, ns.engine, ref, head, caller.actor, true);
  return c.json({ head, changed: true }, 201);
}

const shown = (commit: CommitInfo) => ({
  hash: commit.hash,
  message: commit.message,
  time: commit.time,
  session: commit.session ?? null,
  merged: commit.merged ?? null,
});

export const historyFeature: Feature = {
  register(api) {
    api.openapi(routes.listCommits, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const ns = await readable(c, namespace);
      const log = await ns.engine.log(branch, pageSize(c.req.valid("query").limit, 50));
      return c.json(log.map(shown), 200);
    });

    api.openapi(routes.listChanges, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { since, limit } = c.req.valid("query");
      const ns = await readable(c, namespace);
      const feed = await ns.engine.changesSince(branch, since, pageSize(limit, 50));
      return c.json(
        feed.map((item) => ({ ...shown(item.commit), changes: item.changes })),
        200,
      );
    });

    api.openapi(routes.fileHistory, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { path, limit, after } = c.req.valid("query");
      const ns = await readable(c, namespace);
      const versions = await ns.engine
        .fileHistory(branch, path, after, pageSize(limit))
        .catch((error: unknown) => {
          if (after !== undefined && isMissing(error)) {
            throw badRequest(`commit \`${after}\` is not in the file's history`);
          }
          throw error;
        });
      return c.json(
        versions.map((version) => ({ ...shown(version.commit), size: version.size ?? null })),
        200,
      );
    });

    api.openapi(routes.diffBranches, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { from, against, ...page } = c.req.valid("query");
      const ns = await readable(c, namespace);
      let changes;
      if (against === "base") {
        const [base, head] = await Promise.all([
          ns.engine.mergeBase(branch, from),
          ns.engine.head(branch),
        ]);
        if (!base) throw badRequest(`\`${branch}\` and \`${from}\` share no history`);
        changes = await ns.engine.diffCommits(base, head);
      } else {
        changes = await ns.engine.diff(from, branch);
      }
      return c.json(
        pageOf(changes, (change) => change.path, page),
        200,
      );
    });

    api.openapi(routes.mergeBranches, async (c) => {
      const body = c.req.valid("json");
      const { namespace } = c.req.valid("param");
      const resolve = body.resolve ?? [];
      if (body.dry_run) {
        const { ns } = await changeable(c, namespace, "read");
        const conflicts = await ns.engine.conflicts(body.into, body.from);
        const open = conflicts.filter((path) => !resolve.some((r) => covers(r.path, path)));
        return c.json({ head: null, conflicts: open }, 200);
      }
      const { caller, ns } = await changeable(c, namespace, "write");
      const { db, turns, log } = c.var.services;
      await assertLiveSession(db, ns, body.session);
      const resolved = resolve.length > 0 ? await resolutions(c, ns, resolve) : undefined;
      const message = body.message ?? `Merge ${body.from} into ${body.into}`;
      const merge = () => ns.engine.merge(body.into, body.from, message, body.session, resolved);
      const allowed = atLeast(caller.role, "admin")
        ? merge
        : () =>
            withProtection(db, ns, body.into, (isProtected) => {
              if (isProtected) allow(caller, "admin");
              return merge();
            });
      const lock = `merge/${ns.org}/${ns.name}/${body.into}`;
      const merged = await turns.run(lock, () => withLease(db, lock, allowed, { log }));
      if (!merged.head) {
        const why = errorFields(c, 409, "the merge conflicts; nothing was saved");
        return c.json({ head: null, conflicts: merged.conflicts, ...why }, 409);
      }
      if (resolve.some(addsData)) await filesChanged(c, ns.folder);
      note(c, { details: { into: body.into, from: body.from, head: merged.head } });
      const ref = { org: ns.org, namespace: ns.name, name: body.into };
      await commits.record(db, ns.engine, ref, merged.head, caller.actor, true);
      return c.json({ head: merged.head, conflicts: [] }, 200);
    });

    api.openapi(routes.revertCommit, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { commit: hash, message, session } = c.req.valid("json");
      const writer = await changeable(c, namespace, "write");
      const { ns } = writer;
      await assertLiveSession(c.var.services.db, ns, session);
      const before = await ns.engine.head(branch);
      const { commit, edits, conflicts } = await revertEdits(ns.engine, before, hash);
      if (conflicts.length > 0) {
        const why = errorFields(c, 409, "the branch changed these paths since; nothing was saved");
        return c.json({ conflicts, ...why }, 409);
      }
      note(c, { details: { reverted: hash } });
      const title = commit.message.split("\n")[0];
      return commitEdits(c, writer, branch, before, {
        message: message ?? `Revert "${title}"`,
        session,
        edits,
      });
    });

    api.openapi(routes.resetBranch, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { to, message, session } = c.req.valid("json");
      const writer = await changeable(c, namespace, "write");
      const { ns } = writer;
      await assertLiveSession(c.var.services.db, ns, session);
      const before = await ns.engine.head(branch);
      const edits = await resetEdits(ns.engine, before, to);
      note(c, { details: { to } });
      return commitEdits(c, writer, branch, before, {
        message: message ?? `Reset to ${to.slice(0, 12)}`,
        session,
        edits,
      });
    });
  },
};
