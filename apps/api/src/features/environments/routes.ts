import { environments as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import { allow, mayUse } from "../../auth/roles.ts";
import type { Feature } from "../../http/context.ts";
import { conflict } from "../../http/errors.ts";
import { signedIn } from "../../http/request.ts";
import * as environments from "./queries.ts";

export const environmentsFeature: Feature = {
  register(api) {
    api.openapi(routes.listRegions, async (c) => {
      await signedIn(c);
      return c.json(c.var.services.stores.list(), 200);
    });

    api.openapi(routes.listEnvironments, async (c) => {
      const caller = await signedIn(c);
      const all = await environments.list(c.var.services.db, caller.org);
      return c.json(
        all.filter((env) => mayUse(caller, `${env.name}/`)),
        200,
      );
    });

    api.openapi(routes.createEnvironment, async (c) => {
      const caller = await signedIn(c);
      const { name } = c.req.valid("json");
      allow(caller, "admin", `${name}/`);
      const { db } = c.var.services;
      if (!(await environments.ensure(db, caller.org, name))) {
        throw conflict(`environment \`${name}\` exists`);
      }
      note(c, { details: { environment: name } });
      const environment = (await environments.list(db, caller.org)).find(
        (env) => env.name === name,
      )!;
      return c.json(environment, 201);
    });
  },
};
