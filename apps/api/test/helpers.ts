import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

import { serve } from "@hono/node-server";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { createApp, services } from "../src/app.ts";
import { ConsoleTokens } from "../src/auth/tokens.ts";
import type { Config } from "../src/config.ts";
import { connect, migrate, type Db } from "../src/db/client.ts";

export const ADMIN = "test-admin-token-0123456789";
export const DATABASE = process.env.SKYWAKE_API_DATABASE;
if (!DATABASE && process.env.CI) throw new Error("CI must set SKYWAKE_API_DATABASE");
export const skip = DATABASE ? false : "needs SKYWAKE_API_DATABASE";

let shared: { db: Db; end: () => Promise<void> } | undefined;
after(() => shared?.end());

export async function database() {
  if (!shared) {
    const { db, pool } = connect(DATABASE!, 16);
    await migrate(pool);
    shared = { db, end: () => pool.end() };
  }
  return shared.db;
}

const signing = await generateKeyPair("EdDSA", { extractable: true });
const jwks = createLocalJWKSet({
  keys: [{ ...(await exportJWK(signing.publicKey)), kid: "test", alg: "EdDSA" }],
});

export function token(
  org: string,
  role: string,
  kid = "test",
  expires: string | null = "1m",
  claims: Record<string, unknown> = {},
) {
  const jwt = new SignJWT({ org, role, ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setSubject("user-1")
    .setIssuer("console")
    .setAudience("console");
  if (expires) jwt.setExpirationTime(expires);
  return jwt.sign(signing.privateKey);
}

export const unique = () => Math.random().toString(16).slice(2, 10);

export interface Logged {
  level: string;
  msg: string;
  [field: string]: unknown;
}

export async function server(
  overrides: Partial<Config> = {},
  options: Parameters<typeof services>[3] & { db?: Db } = {},
) {
  const db = options.db ?? (await database());
  const logs: Logged[] = [];
  const store = mkdtempSync(join(tmpdir(), "skywake-api-"));
  const config: Config = {
    database: DATABASE!,
    databasePool: 16,
    regions: [
      ["local", join(store, "local")],
      ["eu", join(store, "eu")],
    ],
    adminToken: ADMIN,
    listen: { hostname: "127.0.0.1", port: 0 },
    corsOrigins: [],
    rateLimit: 0,
    bodyLimit: 1024 * 1024,
    trustProxy: 0,
    auditDays: 0,
    auditReads: "database",
    s3: { region: "us-east-1", endpoint: null },
    placementCheck: false,
    peer: { url: "http://127.0.0.1:0" },
    ...overrides,
  };
  const tokens = new ConsoleTokens(jwks, { issuer: "console", audience: "console" });
  const svc = services(config, db, tokens, { log: (entry) => logs.push(entry), ...options });
  const app = createApp(svc);

  async function call(
    method: string,
    path: string,
    key?: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = { "content-type": "application/json", ...extra };
    if (key) headers.authorization = `Bearer ${key}`;
    const response = await app.request(`/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, body: json, headers: response.headers };
  }

  async function org() {
    const { status, body } = await call("POST", "/orgs", ADMIN, { name: `o-${unique()}` });
    assert.equal(status, 201, JSON.stringify(body));
    return { id: body.id as string, key: body.key as string };
  }

  async function ready() {
    const { id, key } = await org();
    assert.equal((await call("POST", "/namespaces", key, { name: "prod/app" })).status, 201);
    assert.equal(
      (await call("POST", "/namespaces/prod%2Fapp/branches", key, { name: "main" })).status,
      201,
    );
    const commit = { message: "add", changes: [{ path: "a.txt", text: "hello" }] };
    assert.equal(
      (await call("POST", "/namespaces/prod%2Fapp/branches/main/commits", key, commit)).status,
      201,
    );
    return { id, key };
  }

  return { app, db, store, services: svc, logs, call, org, ready };
}

export type Server = Awaited<ReturnType<typeof server>>;

export async function peerPair(token: string) {
  const a = await server({ peer: { url: "http://127.0.0.1:0", token } });
  const b = await server(
    { regions: a.services.config.regions, peer: { url: "http://127.0.0.1:0", token } },
    { db: a.db },
  );
  return [a, b] as const;
}

export async function listen(s: Server) {
  const http = serve({ fetch: s.app.fetch, hostname: "127.0.0.1", port: 0 });
  await once(http, "listening");
  s.services.config.peer.url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return http as HttpServer;
}

export function shut(http: HttpServer) {
  http.closeAllConnections();
  http.close();
}
