import { keys as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import { newKey } from "../../auth/keys.ts";
import { allow, allowOrgAdmin } from "../../auth/roles.ts";
import type { Feature } from "../../http/context.ts";
import { notFound } from "../../http/errors.ts";
import { operator, signedIn } from "../../http/request.ts";
import * as keys from "./queries.ts";

export const keysFeature: Feature = {
  register(api) {
    api.openapi(routes.listKeys, async (c) => {
      const caller = await signedIn(c);
      allowOrgAdmin(caller);
      return c.json(await keys.list(c.var.services.db, caller.org), 200);
    });

    api.openapi(routes.createKey, async (c) => {
      const caller = await signedIn(c);
      const { namespaces = "*", ...body } = c.req.valid("json");
      allow(caller, "admin", namespaces);
      const key = newKey();
      await keys.create(c.var.services.db, caller.org, {
        id: key.id,
        hash: key.hash,
        name: body.name,
        role: body.role,
        namespaces,
        expires: keys.expiresIn(body.expires_in_days, caller.expires),
        createdBy: caller.actor,
        createdByEmail: caller.email ?? null,
      });
      note(c, { details: { key: key.id } });
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
