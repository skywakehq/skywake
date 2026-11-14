import { indexes as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import { mayUse, type Caller } from "../../auth/roles.ts";
import type { Ctx, Feature } from "../../http/context.ts";
import { forbidden, notFound } from "../../http/errors.ts";
import { pageOf } from "../../http/page.ts";
import { addressOf, indexFor, signedIn } from "../../http/request.ts";
import { requires } from "../billing/require.ts";
import * as orgs from "../orgs/queries.ts";
import { deleteIndex, MAIN, makeIndex } from "./lifecycle.ts";
import * as indexes from "./queries.ts";
import { addAttributes, dropAttributes, engineSchema } from "./schemas.ts";
import { statsOf } from "./stats.ts";

async function memberOf(c: Ctx, caller: Caller, org: string): Promise<Caller> {
  if (!caller.memberships) {
    throw forbidden(
      "an API key belongs to one organization; copy to another with a console token of " +
        "someone in both",
    );
  }
  const role = caller.memberships[org];
  if (!role || !(await orgs.exists(c.var.services.db, org))) {
    throw notFound(`organization \`${org}\``);
  }
  await c.var.services.allowlists.check(org, addressOf(c, caller));
  return { ...caller, org, role, memberships: undefined };
}

export const indexesFeature: Feature = {
  register(api) {
    api.openapi(routes.listIndexes, async (c) => {
      const caller = await signedIn(c);
      const all = await indexes.list(c.var.services.db, caller.org);
      const reachable = all.filter((row) => mayUse(caller, row.name));
      return c.json(
        pageOf(reachable, (row) => row.name, c.req.valid("query")).map(indexes.shown),
        200,
      );
    });

    api.openapi(routes.createIndex, async (c) => {
      const caller = await signedIn(c);
      const { name, region, schema, shards, encryption, pinned } = c.req.valid("json");
      const made = await makeIndex(
        c,
        caller,
        { name, region, schema, shards, encryption, pinned },
        ({ store }) => store.create(engineSchema(schema)),
      );
      note(c, { details: { index: name } });
      return c.json(indexes.shown(made), 201);
    });

    api.openapi(routes.copyIndex, async (c) => {
      const { name, branch, region, encryption, target_org } = c.req.valid("json");
      const across = target_org !== undefined && target_org !== (await signedIn(c)).org;
      const { caller, index } = await indexFor(
        c,
        c.req.valid("param").index,
        across ? "write" : "read",
      );
      const target = across ? await memberOf(c, caller, target_org) : caller;
      const { schema, shards } = index;
      await index.store.schema(branch);
      const made = await makeIndex(
        c,
        target,
        { name, region: region ?? index.region, schema, shards, encryption },
        ({ location, options }) => index.store.copy(branch, location, options),
      );
      note(c, { owner: target.org, details: { to: name } });
      return c.json(indexes.shown(made), 201);
    });

    api.openapi(routes.getIndex, async (c) => {
      const { index } = await indexFor(c, c.req.valid("param").index, "read");
      const stats = await statsOf(index.store, MAIN);
      c.var.services.usage.sized(index.org, index.name, stats);
      const pinning = c.var.services.pinning.status(index);
      return c.json({ ...indexes.shown(index), stats, pinning }, 200);
    });

    api.openapi(routes.getIndexUsage, async (c) => {
      const { index } = await indexFor(c, c.req.valid("param").index, "read");
      const { days = 14 } = c.req.valid("query");
      return c.json({ days: await c.var.services.usage.read(index.org, index.name, days) }, 200);
    });

    api.openapi(routes.updateIndex, async (c) => {
      const { index } = await indexFor(c, c.req.valid("param").index, "admin");
      const body = c.req.valid("json");
      const { read_only, retention_days, pinned, attributes = [], drop_attributes = [] } = body;
      const { db } = c.var.services;
      const kept =
        drop_attributes.length > 0 ? await dropAttributes(db, index, drop_attributes) : index;
      await addAttributes(db, kept, attributes);
      if (read_only !== undefined) await indexes.setReadOnly(db, index.org, index.name, read_only);
      if (retention_days !== undefined) {
        await indexes.setRetention(db, index.org, index.name, retention_days);
      }
      if (pinned) await requires(c, index.org, "pinning");
      if (pinned !== undefined) {
        await indexes.setPinned(db, index.org, index.name, pinned?.replicas ?? null);
      }
      return c.json(indexes.shown((await indexes.find(db, index.org, index.name))!), 200);
    });

    api.openapi(routes.deleteIndex, async (c) => {
      const { index } = await indexFor(c, c.req.valid("param").index, "admin");
      await deleteIndex(c, index);
      return c.body(null, 204);
    });
  },
};
