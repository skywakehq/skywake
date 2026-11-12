import { BASE_PATH, describe, files, indexes, info, routes } from "@skywake/contract";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { auditTrail } from "./audit/middleware.ts";
import { AuditRecorder } from "./audit/recorder.ts";
import { postgresSink } from "./audit/store.ts";
import { Access } from "./auth/access.ts";
import { Authenticator, bearer } from "./auth/authenticate.ts";
import { AdminToken } from "./auth/keys.ts";
import type { ConsoleTokens } from "./auth/tokens.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db/client.ts";
import { Stores } from "./engine/stores.ts";
import { Changes } from "./db/changes.ts";
import { Builds } from "./engine/builds.ts";
import { Leases } from "./engine/leases.ts";
import { Turns } from "./engine/turns.ts";
import { auditFeature } from "./features/audit/routes.ts";
import { billingFeature, stripeWebhook, WEBHOOK_PATH } from "./features/billing/routes.ts";
import { Billing } from "./features/billing/service.ts";
import type { Payments } from "./features/billing/payments.ts";
import { StripePayments } from "./features/billing/stripe.ts";
import { PREFIX } from "./features/compat/paths.ts";
import { Places } from "./features/compat/places.ts";
import { compatApp } from "./features/compat/routes.ts";
import { branchesFeature } from "./features/branches/routes.ts";
import { Credentials } from "./features/credentials/mint.ts";
import { credentialsFeature } from "./features/credentials/routes.ts";
import { environmentsFeature } from "./features/environments/routes.ts";
import { filesFeature } from "./features/files/routes.ts";
import { historyFeature } from "./features/history/routes.ts";
import { indexBranchesFeature } from "./features/indexes/branches.ts";
import { indexOperationsFeature } from "./features/indexes/operations.ts";
import { indexReadsFeature } from "./features/indexes/reads.ts";
import { indexesFeature } from "./features/indexes/routes.ts";
import { Models } from "./features/indexes/models.ts";
import { IndexUsage } from "./features/indexes/usage.ts";
import { indexWritesFeature } from "./features/indexes/writes.ts";
import { keysFeature } from "./features/keys/routes.ts";
import { namespacesFeature } from "./features/namespaces/routes.ts";
import { Allowlists } from "./features/orgs/allowlist.ts";
import { orgsFeature } from "./features/orgs/routes.ts";
import { pinnedQueriesFeature } from "./features/pinning/routing.ts";
import { Pinning, serverId } from "./features/pinning/service.ts";
import { sessionsFeature } from "./features/sessions/routes.ts";
import { ssoFeature } from "./features/sso/routes.ts";
import type { AppEnv, Ctx, Feature, Services } from "./http/context.ts";
import { errorBody, errorHandler, jsonPath, unauthorized } from "./http/errors.ts";
import { jsonLog, type Log } from "./http/log.ts";
import { healthRoutes } from "./http/health.ts";
import { Metrics } from "./http/metrics.ts";
import { peerRoutes } from "./http/peer-routes.ts";
import { identify } from "./http/identify.ts";
import { PEER_HEADER } from "./http/peers.ts";
import { clientOf, RateLimiter } from "./http/rate-limit.ts";

const FEATURES: Feature[] = [
  orgsFeature,
  billingFeature,
  ssoFeature,
  keysFeature,
  auditFeature,
  environmentsFeature,
  namespacesFeature,
  credentialsFeature,
  branchesFeature,
  filesFeature,
  historyFeature,
  sessionsFeature,
  indexesFeature,
  indexBranchesFeature,
  indexWritesFeature,
  pinnedQueriesFeature,
  indexReadsFeature,
  indexOperationsFeature,
];

export function services(
  config: Config,
  db: Db,
  tokens: ConsoleTokens | null,
  options: {
    log?: Log;
    metrics?: Metrics;
    credentials?: Credentials | null;
    payments?: Payments;
    now?: () => Date;
  } = {},
): Services {
  const log = options.log ?? jsonLog;
  const id = serverId();
  const leases = new Leases(db, id, config.peer, log);
  const changes = new Changes(db, log);
  const stores = new Stores(config.regions, undefined, leases, config.heads !== undefined);
  const billing = config.billing
    ? new Billing({
        db,
        payments:
          options.payments ??
          new StripePayments(
            config.billing.secretKey,
            config.billing.webhookSecret,
            config.billing.publishableKey,
          ),
        stores,
        sized: (org, index, stats) => usage.sized(org, index, stats),
        log,
        consoleUrl: config.billing.consoleUrl,
        checkout: config.billing.checkout,
        now: options.now,
      })
    : null;
  const usage = new IndexUsage(db, billing);
  const pinning = new Pinning(id, db, config.peer, stores, usage, log);
  const token = config.peer.token;
  const builds =
    token === undefined ? null : new Builds(id, token, () => pinning.live(), stores, log);
  if (builds) stores.splitBuilds(builds);
  return {
    config,
    db,
    stores,
    access: new Access(db, stores, changes),
    auth: new Authenticator(db, tokens, changes, log),
    admin: new AdminToken(config.adminToken),
    turns: new Turns(),
    limiter: config.rateLimit > 0 ? new RateLimiter(db, config.rateLimit) : null,
    credentials:
      options.credentials !== undefined
        ? options.credentials
        : config.sts
          ? new Credentials(config.sts, config.s3.region)
          : null,
    log,
    metrics: options.metrics ?? new Metrics(),
    usage,
    models: new Models(config),
    allowlists: new Allowlists(db, changes),
    leases,
    changes,
    places: new Places(db, changes),
    pinning,
    builds,
    audit: new AuditRecorder(postgresSink(db), log),
    billing,
  };
}

export function createApp(services: Services) {
  const { config, limiter, log, metrics } = services;
  const onError = errorHandler(log);

  const api = new OpenAPIHono<AppEnv>({
    defaultHook: async (result, c) => {
      if (!result.success) {
        // Body errors go only to callers with a key, so strangers learn nothing from them.
        if (result.target === "json" && !(await mayCall(c as unknown as Ctx))) {
          throw unauthorized();
        }
        const { issues } = result.error;
        const shown = issues.map(
          (issue) => `${jsonPath(issue.path) || "request"}: ${issue.message}`,
        );
        const path = issues[0]?.path.length ? jsonPath(issues[0].path) : undefined;
        return errorBody(c, 400, shown.join("; "), path);
      }
    },
  });
  api.use(identify(services));
  for (const feature of FEATURES) feature.register(api);
  describe(api);
  api.doc31("/openapi.json", info);
  api.onError(onError);

  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    const id = crypto.randomUUID();
    c.set("requestId", id);
    c.header("X-Request-Id", id);
    await next();
  });
  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    const seconds = (performance.now() - started) / 1000;
    const route = c.req.routePath;
    metrics.request(c.req.method, route, c.res.status, seconds);
    const who = c.get("who");
    log({
      level: c.res.status >= 500 ? "error" : "info",
      msg: "request",
      request_id: c.get("requestId"),
      client_request_id: c.req.header("x-request-id")?.slice(0, 200) ?? null,
      method: c.req.method,
      route,
      status: c.res.status,
      seconds: Math.round(seconds * 1e6) / 1e6,
      org: who?.org ?? null,
      actor: who?.actor ?? null,
    });
  });
  app.use(secureHeaders());
  app.use(async (c, next) => {
    c.set("fromPeer", services.pinning.admits(c.req.header(PEER_HEADER)));
    await next();
  });
  // Before the rate and body limits, so the calls they refuse are audited too.
  app.use(`${BASE_PATH}/*`, auditTrail(services));
  app.use(`${PREFIX}/*`, auditTrail(services));

  healthRoutes(app, services);

  app.post(WEBHOOK_PATH, (c) => stripeWebhook(c, services));

  peerRoutes(app, services);

  if (config.corsOrigins.length > 0) {
    app.use(
      cors({
        origin: config.corsOrigins,
        allowHeaders: ["authorization", "content-type"],
        exposeHeaders: ["x-request-id", "retry-after"],
        maxAge: 600,
      }),
    );
  }
  if (limiter) {
    app.use(async (c, next) => {
      if (!c.get("fromPeer")) await limiter.hit(c, `ip:${clientOf(c, config.trustProxy)}`);
      await next();
    });
  }
  // Before the limit of all requests, so an upload stops at 16 MiB without reading more.
  app.use(
    `${BASE_PATH}/namespaces/:namespace/uploads`,
    bodyLimit({
      maxSize: files.PART_MAX,
      onError: (c) => errorBody(c, 413, "a part holds at most 16 MiB"),
    }),
  );
  app.use(
    `${BASE_PATH}/indexes/:index/branches/:branch/documents`,
    bodyLimit({
      maxSize: indexes.UPSERT_BYTES_MAX,
      onError: (c) => errorBody(c, 413, "an upsert holds at most 32 MiB"),
    }),
  );
  app.use(
    bodyLimit({
      maxSize: config.bodyLimit,
      onError: (c) => errorBody(c, 413, "the request is too large"),
    }),
  );
  app.route(BASE_PATH, api);
  app.route(PREFIX, compatApp(services));
  app.notFound((c) => {
    const allowed = methodsOf(c.req.path);
    if (allowed.length === 0) return errorBody(c, 404, "no such route");
    c.header("Allow", allowed.join(", "));
    return errorBody(c, 405, `this path takes ${allowed.join(" or ")}, not ${c.req.method}`);
  });
  app.onError(onError);
  return app;
}

const PATHS = Object.values(routes)
  .flat()
  .map((route) => ({
    method: route.method.toUpperCase(),
    pattern: new RegExp(`^${BASE_PATH}${route.path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
  }));

function methodsOf(path: string) {
  return [...new Set(PATHS.filter((p) => p.pattern.test(path)).map((p) => p.method))];
}

async function mayCall(c: Ctx) {
  if (c.get("fromPeer")) return true;
  if (c.var.services.admin.matches(bearer(c.req.header("authorization")))) return true;
  return (await c.var.caller()) !== null;
}
