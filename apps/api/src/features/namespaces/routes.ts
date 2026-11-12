import { namespaces as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import { randomId } from "../../auth/keys.ts";
import { allow, mayUse } from "../../auth/roles.ts";
import type { Feature } from "../../http/context.ts";
import { conflict, notFound } from "../../http/errors.ts";
import { changeable, readable, signedIn } from "../../http/request.ts";
import { admitsFilesystem } from "../billing/require.ts";
import * as environments from "../environments/queries.ts";
import * as namespaces from "./queries.ts";

export const namespacesFeature: Feature = {
  register(api) {
    api.openapi(routes.listNamespaces, async (c) => {
      const caller = await signedIn(c);
      const all = await namespaces.list(c.var.services.db, caller.org);
      return c.json(all.filter((ns) => mayUse(caller, ns.name)).map(namespaces.shown), 200);
    });

    api.openapi(routes.createNamespace, async (c) => {
      const caller = await signedIn(c);
      const { name, region: asked, visibility = "private" } = c.req.valid("json");
      allow(caller, "admin", name);
      await admitsFilesystem(c, caller.org);
      const { db, stores } = c.var.services;
      const region = await environments.place(db, stores, caller.org, name, asked);
      const folder = `${caller.org}/${randomId("ns_")}`;
      const created = await namespaces.create(db, {
        org: caller.org,
        name,
        folder,
        region,
        visibility,
      });
      if (!created) throw conflict(`namespace \`${name}\` exists`);
      note(c, { details: { namespace: name } });
      const row = await namespaces.find(db, caller.org, name);
      if (!row) throw notFound(`namespace \`${name}\``);
      return c.json(namespaces.shown(row), 201);
    });

    api.openapi(routes.getNamespace, async (c) => {
      const ns = await readable(c, c.req.valid("param").namespace);
      return c.json(namespaces.shown(ns), 200);
    });

    api.openapi(routes.updateNamespace, async (c) => {
      const { ns } = await changeable(c, c.req.valid("param").namespace, "admin");
      const { visibility } = c.req.valid("json");
      await namespaces.setVisibility(c.var.services.db, ns.org, ns.name, visibility);
      note(c, { details: { visibility } });
      return c.body(null, 204);
    });
  },
};
