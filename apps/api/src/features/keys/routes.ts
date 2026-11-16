import { keys as routes, scopeOfPattern, type KeyScope } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import { newKey } from "../../auth/keys.ts";
import { allowEnvironment, allowOrgAdmin, covers, type Caller } from "../../auth/roles.ts";
import type { Feature } from "../../http/context.ts";
import { forbidden, notFound } from "../../http/errors.ts";
import { operator, requestEnvironment, signedIn } from "../../http/request.ts";
import * as keys from "./queries.ts";

type NewKey = { environment?: string | null; only?: string[]; namespaces?: string };

function scopeFor(caller: Caller, asked: NewKey): KeyScope {
  const legacy = asked.namespaces === undefined ? null : scopeOfPattern(asked.namespaces);
  const environment =
    asked.environment !== undefined
      ? asked.environment
      : legacy
        ? legacy.environment
        : caller.environment;
  const only = asked.only ?? legacy?.only ?? caller.only;
  if (environment === null) {
    allowOrgAdmin(caller);
    return { environment, only: ["*"] };
  }
  allowEnvironment(caller, "admin", environment);
  if (!covers(caller, only)) throw forbidden("a key can't reach more than the key that makes it");
  return { environment, only };
}

export const keysFeature: Feature = {
  register(api) {
    api.openapi(routes.whoami, async (c) => {
      const caller = await signedIn(c);
      const actor = caller.actor.split(":");
      return c.json(
        {
          organization: caller.org,
          environment: requestEnvironment(c, caller),
          role: caller.role,
          only: caller.only,
          key: actor[0] === "key" ? actor[1]! : null,
          user: actor[0] === "user" ? actor[1]! : null,
          email: caller.email ?? null,
          expires: caller.expires?.toISOString() ?? null,
        },
        200,
      );
    });

    api.openapi(routes.listKeys, async (c) => {
      const caller = await signedIn(c);
      allowOrgAdmin(caller);
      return c.json(await keys.list(c.var.services.db, caller.org), 200);
    });

    api.openapi(routes.createKey, async (c) => {
      const caller = await signedIn(c);
      const body = c.req.valid("json");
      const scope = scopeFor(caller, body);
      const key = newKey();
      await keys.create(c.var.services.db, caller.org, {
        id: key.id,
        hash: key.hash,
        name: body.name,
        role: body.role,
        ...scope,
        expires: keys.expiresIn(body.expires_in_days, caller.expires),
        createdBy: caller.actor,
        createdByEmail: caller.email ?? null,
      });
      note(c, { details: { key: key.id, environment: scope.environment } });
      return c.json({ id: key.id, key: key.key }, 201);
    });

    api.openapi(routes.revokeMemberKeys, async (c) => {
      operator(c);
      const { org, user } = c.req.valid("param");
      const revoked = await keys.removeMadeBy(c.var.services.db, org, `user:${user}`);
      note(c, { org, details: { user, revoked } });
      return c.json({ revoked }, 200);
    });

    api.openapi(routes.deleteKey, async (c) => {
      const caller = await signedIn(c);
      allowOrgAdmin(caller);
      const { id } = c.req.valid("param");
      if (!(await keys.remove(c.var.services.db, caller.org, id))) throw notFound(`key \`${id}\``);
      return c.body(null, 204);
    });
  },
};
