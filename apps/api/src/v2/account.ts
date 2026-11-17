import type { z } from "@hono/zod-openapi";
import { environments, keys, v2 } from "@skywake/contract";

import * as logins from "../features/logins/queries.ts";
import type { V2 } from "./app.ts";
import { segment } from "./forward.ts";
import { pageOf } from "./pages.ts";

const routes = v2.account;

type Key = z.output<typeof keys.Key>;
type Environment = z.output<typeof environments.Environment>;

const keyOf = ({ namespaces: _, ...key }: Key) => key;

export function registerAccount(api: V2) {
  api.openapi(routes.whoami, async (c) => {
    const scope = await c.var.scope();
    return c.json(await scope.v1.get<z.output<typeof keys.Whoami>>("/whoami"), 200);
  });

  api.openapi(routes.listKeys, async (c) => {
    const scope = await c.var.scope();
    const all = await scope.v1.get<Key[]>("/keys");
    return c.json(
      pageOf(all.map(keyOf), (key) => key.id, c.req.valid("query")),
      200,
    );
  });

  api.openapi(routes.createKey, async (c) => {
    const scope = await c.var.scope();
    return c.json(
      await scope.v1.post<z.output<typeof keys.CreatedKey>>("/keys", c.req.valid("json")),
      201,
    );
  });

  api.openapi(routes.revokeKey, async (c) => {
    const scope = await c.var.scope();
    await scope.v1.delete(`/keys/${segment(c.req.valid("param").id)}`);
    return c.body(null, 204);
  });

  api.openapi(routes.listEnvironments, async (c) => {
    const scope = await c.var.scope();
    const all = await scope.v1.get<Environment[]>("/environments");
    return c.json(
      pageOf(all, (env) => env.name, c.req.valid("query")),
      200,
    );
  });

  api.openapi(routes.startLogin, async (c) => {
    const body = c.req.valid("json");
    const { code, expires } = await logins.start(c.var.services.db, {
      keyId: body.key_id,
      keyHash: Buffer.from(body.key_hash, "hex"),
      device: body.device,
    });
    const console = c.var.services.config.consoleUrl;
    return c.json(
      { code, url: console ? `${console}/cli/${code}` : null, expires: expires.toISOString() },
      201,
    );
  });

  api.openapi(routes.createEnvironment, async (c) => {
    const scope = await c.var.scope();
    return c.json(await scope.v1.post<Environment>("/environments", c.req.valid("json")), 201);
  });
}
