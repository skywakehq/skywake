import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { AuditRecorder } from "../audit/recorder.ts";
import type { Note } from "../audit/note.ts";
import type { Access } from "../auth/access.ts";
import type { Authenticator } from "../auth/authenticate.ts";
import type { AdminToken } from "../auth/keys.ts";
import type { Caller } from "../auth/roles.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import type { Builds } from "../engine/builds.ts";
import type { Leases } from "../engine/leases.ts";
import type { Stores } from "../engine/stores.ts";
import type { Turns } from "../engine/turns.ts";
import type { Changes } from "../db/changes.ts";
import type { Billing } from "../features/billing/service.ts";
import type { Places } from "../features/compat/places.ts";
import type { Credentials } from "../features/credentials/mint.ts";
import type { Allowlists } from "../features/orgs/allowlist.ts";
import type { Models } from "../features/indexes/models.ts";
import type { IndexUsage } from "../features/indexes/usage.ts";
import type { Pinning } from "../features/pinning/service.ts";
import type { Buckets } from "../features/environments/buckets.ts";
import type { Log } from "./log.ts";
import type { Metrics } from "./metrics.ts";
import type { RateLimiter } from "./rate-limit.ts";

export interface Services {
  config: Config;
  db: Db;
  stores: Stores;
  access: Access;
  auth: Authenticator;
  admin: AdminToken;
  turns: Turns;
  limiter: RateLimiter | null;
  credentials: Credentials | null;
  log: Log;
  metrics: Metrics;
  usage: IndexUsage;
  models: Models;
  allowlists: Allowlists;
  leases: Leases;
  changes: Changes;
  places: Places;
  pinning: Pinning;
  builds: Builds | null;
  audit: AuditRecorder;
  billing: Billing | null;
  buckets: Buckets;
}

export type AppEnv = {
  Variables: {
    services: Services;
    caller: () => Promise<Caller | null>;
    who?: Caller;
    requestId: string;
    fromPeer?: boolean;
    rateLimitRemaining?: number;
    audit?: Note;
  };
};

export type Api = OpenAPIHono<AppEnv>;
export type Ctx = Context<AppEnv>;

export interface Feature {
  register(api: Api): void;
}
