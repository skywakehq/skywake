import type { Hono } from "hono";

import { BUILD_PATH, orderOf } from "../engine/builds.ts";
import { MOVED_PATH } from "../engine/leases.ts";
import type { AppEnv, Services } from "./context.ts";
import { errorBody } from "./errors.ts";

export function peerRoutes(app: Hono<AppEnv>, services: Services) {
  app.post(MOVED_PATH, async (c) => {
    if (!c.get("fromPeer")) return errorBody(c, 404, "no such route");
    const { folder, branch } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof folder !== "string" || typeof branch !== "string") {
      return errorBody(c, 400, "takes a folder and a branch");
    }
    services.leases.heard(folder, branch);
    return c.body(null, 204);
  });

  app.post(BUILD_PATH, async (c) => {
    if (!c.get("fromPeer") || !services.builds) return errorBody(c, 404, "no such route");
    const order = orderOf(await c.req.json().catch(() => null));
    if (!order) return errorBody(c, 400, "takes a build order");
    await services.builds.build(order);
    return c.body(null, 204);
  });
}
