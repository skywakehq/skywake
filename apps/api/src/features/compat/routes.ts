import { Hono } from "hono";

import type { AppEnv, Ctx, Services } from "../../http/context.ts";
import { identify } from "../../http/identify.ts";
import { branchFrom, copyFrom, poll, startCopy } from "./copies.ts";
import { metadata, recall, schema, updateMetadata, updateSchema, warm } from "./metadata.ts";
import * as names from "./names.ts";
import { type Action, ROUTES } from "./paths.ts";
import { explain, query } from "./query.ts";
import { bodyOf, errors } from "./wire.ts";
import { write } from "./write.ts";

const PAGE_SIZE = 100;
const PAGE_MAX = 1000;

const HANDLERS: Record<Action, (c: Ctx, name: string) => Promise<unknown>> = {
  "compat.listNamespaces": (c) =>
    names.list(c, {
      prefix: c.req.query("prefix"),
      cursor: c.req.query("cursor"),
      size: Math.min(
        Math.max(Number(c.req.query("page_size") ?? PAGE_SIZE) || PAGE_SIZE, 1),
        PAGE_MAX,
      ),
    }),
  "compat.write": async (c, name) => {
    const body = await bodyOf(c);
    if (body.branch_from_namespace !== undefined) return branchFrom(c, name, body);
    if (body.copy_from_namespace !== undefined) return copyFrom(c, name, body);
    return write(c, name, body);
  },
  "compat.deleteNamespace": async (c, name) => {
    await names.remove(c, name);
    return { status: "OK" };
  },
  "compat.startCopy": async (c, name) => startCopy(c, name, await bodyOf(c)),
  "compat.pollCopy": (c) => poll(c, c.req.param("namespace")!, c.req.param("token")!),
  "compat.query": async (c, name) => query(c, name, await bodyOf(c)),
  "compat.explain": async (c, name) => explain(c, name, await bodyOf(c)),
  "compat.metadata": metadata,
  "compat.updateMetadata": async (c, name) => updateMetadata(c, name, await bodyOf(c)),
  "compat.schema": schema,
  "compat.updateSchema": async (c, name) => updateSchema(c, name, await bodyOf(c)),
  "compat.warmCache": warm,
  "compat.recall": async (c, name) => recall(c, name, await bodyOf(c)),
};

export function compatApp(services: Services) {
  const app = new Hono<AppEnv>();
  app.use(identify(services));
  for (const route of ROUTES) {
    app.on(route.method, route.path, async (c) => {
      const answer = await HANDLERS[route.action](c as Ctx, c.req.param("namespace") ?? "");
      return c.json(answer as object, 200);
    });
  }
  app.onError(errors(services.log));
  return app;
}
