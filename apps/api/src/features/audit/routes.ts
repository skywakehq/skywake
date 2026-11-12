import { audit as routes } from "@skywake/contract";

import { allowOrgAdmin } from "../../auth/roles.ts";
import { requires } from "../billing/require.ts";
import { badRequest } from "../../http/errors.ts";
import type { Feature } from "../../http/context.ts";
import { pageSize } from "../../http/page.ts";
import { operator, signedIn } from "../../http/request.ts";
import * as audit from "./queries.ts";

export const auditFeature: Feature = {
  register(api) {
    api.openapi(routes.auditLog, async (c) => {
      const caller = await signedIn(c);
      allowOrgAdmin(caller);
      await requires(c, caller.org, "audit_log");
      const query = c.req.valid("query");
      const after = query.after === undefined ? undefined : Number(query.after);
      if (after !== undefined && !Number.isSafeInteger(after))
        throw badRequest("`after` is an event id");
      // This server's newest events are still in memory; write them first.
      await c.var.services.audit.flush();
      const found = await audit.page(c.var.services.db, caller.org, pageSize(query.limit, 100), {
        after,
        since: date(query.since, "since"),
        until: date(query.until, "until"),
        actor: query.actor,
        action: query.action,
        outcome: query.outcome,
      });
      return c.json(found, 200);
    });

    api.openapi(routes.recordAuditEvents, async (c) => {
      operator(c);
      const { events } = c.req.valid("json");
      const times = events.map((event, i) => date(event.at, `events[${i}].at`)!);
      events.forEach((event, i) => {
        c.var.services.audit.record({
          ...event,
          at: times[i]!,
          owner: null,
          actorKind: "person",
          resource: {},
          clientRequestId: null,
          durationMs: 0,
          bytesIn: null,
          bytesOut: null,
        });
      });
      return c.body(null, 204);
    });
  },
};

function date(text: string | undefined, name: string) {
  if (text === undefined) return undefined;
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) throw badRequest(`\`${name}\` is not a time`);
  return at;
}
