import { logins as routes, type Role } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import { allowEnvironment, allowOrgAdmin, isOrgAdmin, type Caller } from "../../auth/roles.ts";
import type { Feature } from "../../http/context.ts";
import { forbidden, notFound } from "../../http/errors.ts";
import { signedIn } from "../../http/request.ts";
import { expiresIn } from "../keys/queries.ts";
import * as logins from "./queries.ts";

export function scopeFor(caller: Caller, environment: string | null, role: Role) {
  if (!caller.actor.startsWith("user:"))
    throw forbidden("only a person signed in to the console can approve a sign-in");
  if (environment === null) allowOrgAdmin(caller);
  else allowEnvironment(caller, role, environment);
  return { environment, only: caller.only };
}

export const loginsFeature: Feature = {
  register(api) {
    api.openapi(routes.getLogin, async (c) => {
      const caller = await signedIn(c);
      const login = await logins.find(c.var.services.db, logins.codeOf(c.req.valid("param").code));
      if (!login) throw notFound("this sign-in");
      return c.json(
        {
          code: login.code,
          device: login.device,
          expires: login.expires.toISOString(),
          role: caller.role,
          every_environment: isOrgAdmin(caller),
        },
        200,
      );
    });

    api.openapi(routes.approveLogin, async (c) => {
      const caller = await signedIn(c);
      const { environment, role } = c.req.valid("json");
      const scope = scopeFor(caller, environment, role);
      const key = await logins.approve(
        c.var.services.db,
        caller.org,
        logins.codeOf(c.req.valid("param").code),
        {
          role,
          ...scope,
          expires: expiresIn(undefined, caller.expires),
          createdBy: caller.actor,
          createdByEmail: caller.email ?? null,
        },
      );
      if (!key) throw notFound("this sign-in");
      note(c, { details: { key: key.id, environment } });
      return c.json({ id: key.id, name: key.name, role, environment }, 200);
    });
  },
};
