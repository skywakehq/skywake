import { indexes as routes } from "@skywake/contract";
import type { IndexVersion } from "@skywake/engine";

import { note } from "../../audit/note.ts";
import type { Feature } from "../../http/context.ts";
import { conflict, isMissing, notFound } from "../../http/errors.ts";
import { indexFor } from "../../http/request.ts";
import { MAIN, writable } from "./lifecycle.ts";
import * as indexes from "./queries.ts";
import { statsOf } from "./stats.ts";

const shownVersion = (version: IndexVersion) => ({
  ...version,
  time: new Date(version.time).toISOString(),
});

export const indexBranchesFeature: Feature = {
  register(api) {
    api.openapi(routes.listIndexBranches, async (c) => {
      const { index } = await indexFor(c, c.req.valid("param").index, "read");
      const page = c.req.valid("query");
      return c.json(
        await indexes.listBranches(c.var.services.db, index.org, index.name, page),
        200,
      );
    });

    api.openapi(routes.mergeIndexBranch, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await writable(c, name, branch);
      const { from } = c.req.valid("json");
      const rows = await index.store.merge(branch, from);
      note(c, { details: { from } });
      return c.json({ rows }, 200);
    });

    api.openapi(routes.forkIndexBranch, async (c) => {
      const { index } = await indexFor(c, c.req.valid("param").index, "write");
      const { name, from, at } = c.req.valid("json");
      const { db } = c.var.services;
      const ref = { org: index.org, index: index.name, name };
      if (!(await indexes.addBranch(db, ref, from))) {
        throw conflict(`branch \`${name}\` already exists`);
      }
      try {
        await index.store.fork(from, name, at, index.retentionDays);
      } catch (error) {
        await indexes.removeBranch(db, ref);
        throw error;
      }
      note(c, { details: { branch: name } });
      return c.json((await indexes.findBranch(db, ref))!, 201);
    });

    api.openapi(routes.listIndexVersions, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const { limit = 20, after } = c.req.valid("query");
      const versions = await index.store.versions(branch, after, limit);
      return c.json(versions.map(shownVersion), 200);
    });

    api.openapi(routes.restoreIndexBranch, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await writable(c, name, branch);
      const { version } = c.req.valid("json");
      const restored = await index.store.restore(branch, version, index.retentionDays);
      note(c, { details: { version } });
      const [now] = await index.store.versions(branch, null, 1);
      return c.json(shownVersion(now ?? { version: restored, time: Date.now(), rows: 0 }), 200);
    });

    api.openapi(routes.getIndexBranch, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "read");
      const ref = { org: index.org, index: index.name, name: branch };
      const found = await indexes.findBranch(c.var.services.db, ref);
      if (!found) throw notFound(`branch \`${branch}\``);
      const stats = await statsOf(index.store, branch);
      if (branch === MAIN) c.var.services.usage.sized(index.org, index.name, stats);
      return c.json({ ...found, stats }, 200);
    });

    api.openapi(routes.deleteIndexBranch, async (c) => {
      const { index: name, branch } = c.req.valid("param");
      const { index } = await indexFor(c, name, "write");
      if (branch === MAIN) throw conflict("`main` stays while the index does; delete the index");
      const { db } = c.var.services;
      const ref = { org: index.org, index: index.name, name: branch };
      if (!(await indexes.findBranch(db, ref))) throw notFound(`branch \`${branch}\``);
      try {
        await index.store.deleteBranch(branch);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      await indexes.removeBranch(db, ref);
      return c.body(null, 204);
    });
  },
};
