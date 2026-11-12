import type { MiddlewareHandler } from "hono";

import { bearer } from "../auth/authenticate.ts";
import type { AppEnv, Ctx, Services } from "../http/context.ts";
import { clientAddress } from "../http/rate-limit.ts";
import { actionOf } from "./actions.ts";
import { type ActorKind, type AuditEvent, outcomeOf } from "./event.ts";

export const auditTrail =
  (services: Services): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const started = performance.now();
    const at = new Date();
    await next();
    const action = actionOf(c.req.method, c.req.routePath);
    if (!action || c.get("fromPeer")) return;
    if (action === "recordAuditEvents" && c.res.status === 204) return;
    try {
      const event = eventOf(c, services, action, at, performance.now() - started);
      if (services.config.auditReads === "log" && isRead(c.req.method, action)) {
        services.log({ level: "info", msg: "audit", ...event });
      } else {
        services.audit.record(event);
      }
    } catch (error) {
      services.log({
        level: "error",
        msg: "audit event not recorded",
        action,
        error: String(error),
      });
    }
  };

const READ_POSTS = new Set([
  "aggregateDocuments",
  "checkRecall",
  "diffBranches",
  "exportDocuments",
  "hybridQuery",
  "multiQuery",
  "orderDocuments",
  "queryIndex",
  "rankDocuments",
  "searchFiles",
  "searchIndex",
]);

export const isRead = (method: string, action: string) =>
  method === "GET" || method === "HEAD" || (method === "POST" && READ_POSTS.has(action));

function eventOf(c: Ctx, services: Services, action: string, at: Date, ms: number): AuditEvent {
  const who = c.get("who");
  const kind = kindOf(c, services);
  const noted = c.get("audit");
  const org = noted?.org ?? who?.org ?? null;
  const details = noted?.details && Object.keys(noted.details).length > 0 ? noted.details : null;
  return {
    at,
    org,
    owner: noted?.owner && noted.owner !== org ? noted.owner : null,
    actor: who?.actor ?? (kind === "operator" ? "admin" : null),
    actorKind: kind,
    action,
    outcome: outcomeOf(c.res.status),
    status: c.res.status,
    method: c.req.method,
    route: c.req.routePath,
    resource: paramsOf(c),
    details,
    requestId: c.get("requestId"),
    clientRequestId: c.req.header("x-request-id")?.slice(0, 200) ?? null,
    ip: who?.address ?? clientAddress(c, services.config.trustProxy),
    userAgent: c.req.header("user-agent")?.slice(0, 500) ?? null,
    durationMs: Math.round(ms * 1000) / 1000,
    bytesIn: size(c.req.header("content-length")),
    bytesOut: size(c.res.headers.get("content-length")),
  };
}

function kindOf(c: Ctx, services: Services): ActorKind {
  const who = c.get("who");
  if (who) return who.address === undefined ? "key" : "person";
  if (services.admin.matches(bearer(c.req.header("authorization")))) return "operator";
  return "anonymous";
}

function size(header: string | null | undefined) {
  const n = Number(header);
  return header && Number.isFinite(n) ? n : null;
}

function paramsOf(c: Ctx): Record<string, string> {
  try {
    return c.req.param();
  } catch {
    return {};
  }
}
