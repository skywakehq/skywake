import type { MiddlewareHandler } from "hono";

import { bearer } from "../auth/authenticate.ts";
import type { AppEnv, Services } from "./context.ts";
import { addressOf } from "./request.ts";

/** The request reads only, so the caller remembered from an earlier request will do. */
const QUERY = /\/(query|search|hybrid|multi|rank|order|aggregate)$/;
const reads = (method: string, path: string) =>
  method === "GET" || method === "HEAD" || (method === "POST" && QUERY.test(path));

/** Gives handlers the services and a lazy `caller`, checked against limits and allowlists once. */
export const identify =
  (services: Services): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    c.set("services", services);
    let caller: ReturnType<AppEnv["Variables"]["caller"]> | undefined;
    const find = async () => {
      const who = await services.auth.caller(bearer(c.req.header("authorization")));
      if (who) {
        if (!reads(c.req.method, c.req.path)) await services.auth.recheck(who);
        c.set("who", who);
        // Each key or user has its own limit too, so many agents behind one
        // address are not stopped by the address's limit alone.
        if (!c.get("fromPeer")) await services.limiter?.hit(c, `actor:${who.org}/${who.actor}`);
        await services.allowlists.check(who.org, addressOf(c, who));
      }
      return who;
    };
    c.set("caller", () => (caller ??= find()));
    await next();
  };
