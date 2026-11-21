import { OpenAPIHono } from "@hono/zod-openapi";
import { v2 } from "@skywake/contract";
import type { Context } from "hono";

import type { Api, AppEnv, Services } from "../http/context.ts";
import { jsonPath } from "../http/errors.ts";
import { identify } from "../http/identify.ts";
import { registerAccount } from "./account.ts";
import { registerDisks } from "./disks.ts";
import { errorBody, errorHandler, Failure } from "./errors.ts";
import { innerApp } from "./forward.ts";
import { type Scope, scopeOf } from "./scope.ts";

export type V2Env = { Variables: AppEnv["Variables"] & { scope: () => Promise<Scope> } };
export type V2 = OpenAPIHono<V2Env>;
export type V2Ctx = Context<V2Env>;

const UNROUTED = [v2.disks.readFile, v2.disks.writeFile, v2.disks.deleteFile, v2.disks.upload];

export function v2App(services: Services, v1: Api) {
  const inner = innerApp(services, v1);
  const api: V2 = new OpenAPIHono<V2Env>({
    defaultHook: (result, c) => {
      if (result.success) return;
      const issue = result.error.issues[0];
      const path = issue?.path.length ? jsonPath(issue.path) : undefined;
      const shown = result.error.issues.map(
        (i) => `${jsonPath(i.path) || "request"}: ${i.message}`,
      );
      return errorBody(c, new Failure(400, shown.join("; "), { path }));
    },
  });
  api.use(identify(services));
  api.use(async (c, next) => {
    let scope: Promise<Scope> | undefined;
    c.set("scope", () => (scope ??= scopeOf(c as never, inner)));
    await next();
  });
  registerAccount(api);
  registerDisks(api);
  v2.describe(api);
  for (const route of UNROUTED) api.openAPIRegistry.registerPath(route);
  api.doc31("/openapi.json", v2.info);
  api.onError(errorHandler(services.log));
  return api;
}

export const v2NotFound = (c: Context) =>
  errorBody(c, new Failure(404, "no such route", { hint: "see GET /v2/openapi.json" }));
