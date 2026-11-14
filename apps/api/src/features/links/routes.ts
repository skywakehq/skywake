import { indexes as indexContract, links as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import type { Ctx, Feature } from "../../http/context.ts";
import { badRequest, conflict, isMissing, notFound } from "../../http/errors.ts";
import { changeable, indexFor } from "../../http/request.ts";
import { isBucketRegion } from "../environments/buckets.ts";
import { MAIN, makeIndex } from "../indexes/lifecycle.ts";
import * as indexes from "../indexes/queries.ts";
import { engineSchema } from "../indexes/schemas.ts";
import * as links from "./queries.ts";

const shownBranch = (row: links.LinkedBranchRow) => ({
  branch: row.branch,
  synced: row.synced,
  behind: row.dirty || row.synced === null,
  syncedAt: row.syncedAt?.toISOString() ?? null,
  error: row.error,
});

async function shown(c: Ctx, link: links.Link) {
  const rows = await links.branches(c.var.services.db, link.org, link.namespace);
  return {
    namespace: link.namespace,
    index: link.index,
    include: link.include,
    exclude: link.exclude,
    maxBytes: link.maxBytes,
    created: link.created.toISOString(),
    branches: rows.map(shownBranch),
  };
}

/** The schema of an index a link makes: a file's path and text, and its vector when asked. */
function linkSchema(embed: { model: string; dims: number } | undefined) {
  return indexContract.IndexSchema.parse({
    attributes: [
      { name: "path", type: "string" },
      { name: "text", type: "text" },
      ...(embed ? [{ name: "summary", type: "string" }] : []),
    ],
    vectors: embed
      ? [{ name: "embedding", dims: embed.dims, embed: { model: embed.model, from: "summary" } }]
      : [],
  });
}

/** Whether an existing index can hold files: `path` a string, `text` searchable text. */
function holdsFiles(schema: indexes.IndexRow["schema"]) {
  const type = (name: string) => schema.attributes.find((column) => column.name === name)?.type;
  return type("path") === "string" && type("text") === "text" && schema.id === undefined;
}

export const linksFeature: Feature = {
  register(api) {
    api.openapi(routes.linkIndex, async (c) => {
      const { caller, ns } = await changeable(c, c.req.valid("param").namespace, "admin");
      const asked = c.req.valid("json");
      const { db } = c.var.services;
      let row = await indexes.find(db, ns.org, asked.index);
      if (row) {
        if (asked.embed) throw badRequest("`embed` is only for an index the link makes");
        await indexFor(c, asked.index, "write");
        if (!holdsFiles(row.schema)) {
          throw conflict(
            `index \`${asked.index}\` needs a \`path\` string and a \`text\` text attribute`,
          );
        }
      } else {
        const schema = linkSchema(asked.embed);
        // Next to the files: in their region, or in the bucket their environment brings.
        const region = isBucketRegion(ns.region) ? undefined : ns.region;
        row = await makeIndex(
          c,
          caller,
          { name: asked.index, region, schema, shards: 1, encryption: undefined },
          ({ store }) => store.create(engineSchema(schema)),
        );
      }
      const before = await links.find(db, ns.org, ns.name);
      // Another index starts over: its branches are indexed in full.
      if (before && before.index !== row.name) await links.remove(db, ns.org, ns.name);
      await links.save(db, {
        org: ns.org,
        namespace: ns.name,
        index: row.name,
        include: asked.include,
        exclude: asked.exclude,
        maxBytes: asked.maxBytes,
      });
      await links.addBranch(db, ns.org, ns.name, MAIN, null);
      if (before && before.index === row.name) {
        // New globs change which files belong: index everything again.
        await links.reindex(db, ns.org, ns.name);
      }
      note(c, { details: { index: row.name } });
      return c.json(await shown(c, (await links.find(db, ns.org, ns.name))!), 200);
    });

    api.openapi(routes.getIndexLink, async (c) => {
      const { ns } = await changeable(c, c.req.valid("param").namespace, "read");
      const link = await links.find(c.var.services.db, ns.org, ns.name);
      if (!link) throw notFound(`an index link of \`${ns.name}\``);
      return c.json(await shown(c, link), 200);
    });

    api.openapi(routes.unlinkIndex, async (c) => {
      const { ns } = await changeable(c, c.req.valid("param").namespace, "admin");
      const { db } = c.var.services;
      if (!(await links.find(db, ns.org, ns.name))) {
        throw notFound(`an index link of \`${ns.name}\``);
      }
      await links.remove(db, ns.org, ns.name);
      note(c, {});
      return c.body(null, 204);
    });

    api.openapi(routes.getBranchIndex, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { ns } = await changeable(c, namespace, "read");
      const { db } = c.var.services;
      const link = await links.find(db, ns.org, ns.name);
      const row = link && (await links.branch(db, ns.org, ns.name, branch));
      if (!link || !row) throw notFound(`an index of branch \`${branch}\``);
      let head: string;
      try {
        head = await ns.engine.head(branch);
      } catch (error) {
        if (isMissing(error)) throw notFound(`branch \`${branch}\``);
        throw error;
      }
      const stamp = row.synced
        ? await links.stampOf(db, ns.org, link.index, branch, row.synced)
        : null;
      return c.json(
        {
          ...shownBranch(row),
          behind: row.synced !== head,
          head,
          version: stamp?.version ?? null,
        },
        200,
      );
    });

    api.openapi(routes.branchAdvanced, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { ns } = await changeable(c, namespace, "write");
      await links.moved(c.var.services.db, ns.org, ns.name, branch, false);
      return c.body(null, 202);
    });
  },
};

/**
 * Starts the index of a branch just forked from `from` at `at`: a fork of the
 * index branch at the newest version stamped for `from`, so only what differs
 * from that stamp's commit is indexed. Any stamp is right, since a sync diffs
 * trees, not history; one nearer `at` only means less to index. Without one,
 * the branch is indexed in full.
 */
export async function forkIndex(
  c: Ctx,
  org: string,
  namespace: string,
  name: string,
  from: string | null,
  at: string | null,
) {
  const { db, stores } = c.var.services;
  const link = await links.find(db, org, namespace);
  if (!link) throw conflict(`namespace \`${namespace}\` has no index to fork`);
  const row = await indexes.find(db, org, link.index);
  const stamp =
    row && from
      ? ((at && (await links.stampOf(db, org, link.index, from, at))) ??
        (await links.stamps(db, org, link.index, from, 1))[0])
      : undefined;
  if (!row || !stamp) {
    await links.addBranch(db, org, namespace, name, null);
    return;
  }
  const ref = { org, index: link.index, name };
  if (!(await indexes.addBranch(db, ref, from))) {
    // An index branch of that name is left from before: index it in full.
    await links.addBranch(db, org, namespace, name, null);
    return;
  }
  try {
    await stores.ready(row.region);
    const index = stores.index(row.region, row.folder, indexes.openOptions(row));
    await index.fork(from!, name, stamp.version, row.retentionDays);
  } catch {
    // Such as a stamp older than the index keeps versions: index it in full.
    await indexes.removeBranch(db, ref);
    await links.addBranch(db, org, namespace, name, null);
    return;
  }
  await links.addBranch(db, org, namespace, name, stamp.commit);
}

/** A files branch is gone: so is its index branch, except `main`, which every index keeps. */
export async function dropIndex(c: Ctx, org: string, namespace: string, name: string) {
  const { db, stores, log } = c.var.services;
  const link = await links.find(db, org, namespace);
  if (!link) return;
  await links.removeBranch(db, org, namespace, name);
  if (name === MAIN) return;
  const row = await indexes.find(db, org, link.index);
  if (!row) return;
  try {
    await stores.ready(row.region);
    const index = stores.index(row.region, row.folder, indexes.openOptions(row));
    await index.deleteBranch(name);
  } catch (error) {
    if (!isMissing(error)) {
      log({ level: "warn", msg: "index branch not deleted", org, index: link.index, branch: name });
      return;
    }
  }
  await indexes.removeBranch(db, { org, index: link.index, name });
}
