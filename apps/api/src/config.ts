import { apiEnv, readEnv } from "@skywake/env";
import { z } from "zod";

import { type Item, type Prices, PRICE, PRICES } from "./features/orgs/invoices.ts";

export interface Config {
  database: string;
  databasePool: number;
  regions: [name: string, store: string][];
  adminToken?: string;
  jwks?: { url: string; issuer: string; audience: string };
  listen: { hostname: string; port: number };
  metricsListen?: { hostname: string; port: number };
  corsOrigins: string[];
  rateLimit: number;
  bodyLimit: number;
  auditDays: number;
  auditReads: "database" | "log";
  trustProxy: number;
  s3: { region: string; endpoint: string | null };
  placementCheck: boolean;
  sts?: { roleArn: string; endpoint?: string; seconds: number };
  /** Seals secrets kept in Postgres, such as the keys of a customer's bucket. */
  secretKey?: Buffer;
  /** What customers trust in the role of a bucket they bring. */
  byobPrincipal?: string;
  heads?: { nodes: string[]; token: string };
  embed?: Provider;
  rerank?: Provider;
  vendors?: Vendors;
  prices?: Partial<Prices>;
  peer: Peer;
  billing?: BillingConfig;
}

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  checkout: "hosted" | "custom";
  publishableKey: string | null;
  consoleUrl: string;
}

export interface Peer {
  url: string;
  token?: string;
}

export interface Provider {
  url: string;
  key?: string;
}

export type Vendors = Record<string, { key?: string; url?: string; rerankUrl?: string }>;

const VendorsJson = z.record(
  z.string(),
  z.strictObject({
    key: z.string().min(1).optional(),
    url: z.url().optional(),
    rerank_url: z.url().optional(),
  }),
);

function vendors(text: string): Vendors {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("SKYWAKE_API_PROVIDERS is not JSON");
  }
  const parsed = VendorsJson.safeParse(json);
  if (!parsed.success) {
    throw new Error(`SKYWAKE_API_PROVIDERS: ${parsed.error.issues[0]!.message}`);
  }
  const trim = (url: string | undefined) => url?.replace(/\/+$/, "");
  return Object.fromEntries(
    Object.entries(parsed.data).map(([name, v]) => [
      name,
      { key: v.key, url: trim(v.url), rerankUrl: trim(v.rerank_url) },
    ]),
  );
}

function secretKey(text: string | undefined) {
  if (text === undefined) return undefined;
  const key = Buffer.from(text, "base64");
  if (key.length !== 32) throw new Error("SKYWAKE_API_SECRET_KEY must be 32 bytes in base64");
  return key;
}

const list = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const values = readEnv(apiEnv, env);

  const regions: Config["regions"] = [[values.SKYWAKE_API_REGION, values.SKYWAKE_STORE]];
  for (const region of list(values.SKYWAKE_API_REGIONS)) {
    const at = region.indexOf("=");
    if (at < 1) throw new Error(`SKYWAKE_API_REGIONS needs name=store, not \`${region}\``);
    regions.push([region.slice(0, at), region.slice(at + 1)]);
  }

  let jwks: Config["jwks"];
  if (values.SKYWAKE_API_JWKS_URL) {
    const issuer = values.SKYWAKE_API_JWT_ISSUER;
    const audience = values.SKYWAKE_API_JWT_AUDIENCE;
    // Without both, a token another service signed with the same keys would pass.
    if (!issuer || !audience) {
      throw new Error("SKYWAKE_API_JWKS_URL needs SKYWAKE_API_JWT_ISSUER and _JWT_AUDIENCE too");
    }
    jwks = { url: values.SKYWAKE_API_JWKS_URL, issuer, audience };
  }

  const listen = address("SKYWAKE_API_LISTEN", values.SKYWAKE_API_LISTEN);
  return {
    database: values.SKYWAKE_API_DATABASE,
    databasePool: values.SKYWAKE_API_DATABASE_POOL,
    regions,
    adminToken: values.SKYWAKE_API_ADMIN_TOKEN,
    jwks,
    listen,
    metricsListen:
      values.SKYWAKE_API_METRICS_LISTEN === undefined
        ? undefined
        : address("SKYWAKE_API_METRICS_LISTEN", values.SKYWAKE_API_METRICS_LISTEN),
    corsOrigins: list(values.SKYWAKE_API_CORS_ORIGINS),
    rateLimit: values.SKYWAKE_API_RATE_LIMIT,
    bodyLimit: values.SKYWAKE_API_BODY_LIMIT_MB * 1024 * 1024,
    auditDays: values.SKYWAKE_API_AUDIT_DAYS,
    auditReads: values.SKYWAKE_API_AUDIT_READS,
    trustProxy: values.SKYWAKE_API_TRUST_PROXY,
    s3: {
      region: values.AWS_REGION || values.AWS_DEFAULT_REGION || "us-east-1",
      endpoint: values.AWS_ENDPOINT || values.AWS_ENDPOINT_URL || null,
    },
    placementCheck: values.SKYWAKE_API_PLACEMENT_CHECK === "true",
    sts: values.SKYWAKE_API_STS_ROLE_ARN
      ? {
          roleArn: values.SKYWAKE_API_STS_ROLE_ARN,
          endpoint: values.SKYWAKE_API_STS_ENDPOINT,
          seconds: values.SKYWAKE_API_STS_SECONDS,
        }
      : undefined,
    secretKey: secretKey(values.SKYWAKE_API_SECRET_KEY),
    byobPrincipal: values.SKYWAKE_API_BYOB_PRINCIPAL,
    heads: heads(values.SKYWAKE_HEADS, values.SKYWAKE_CACHE_NODES, values.SKYWAKE_CACHE_TOKEN),
    embed: provider(values.SKYWAKE_API_EMBED_URL, values.SKYWAKE_API_EMBED_KEY),
    rerank: provider(values.SKYWAKE_API_RERANK_URL, values.SKYWAKE_API_RERANK_KEY),
    vendors: vendors(values.SKYWAKE_API_PROVIDERS),
    prices: prices(values.SKYWAKE_API_PRICES),
    billing: billing(values),
    peer: {
      url: (values.SKYWAKE_API_PEER_URL ?? `http://127.0.0.1:${listen.port}`).replace(/\/+$/, ""),
      token: values.SKYWAKE_API_PEER_TOKEN,
    },
  };
}

function heads(where: "bucket" | "tier", nodes: string, token: string | undefined) {
  if (where === "bucket") return undefined;
  const urls = list(nodes);
  if (urls.length === 0 || !token) {
    throw new Error("SKYWAKE_HEADS=tier needs SKYWAKE_CACHE_NODES and SKYWAKE_CACHE_TOKEN");
  }
  return { nodes: urls, token };
}

function prices(text: string) {
  const set: Partial<Prices> = {};
  for (const entry of list(text)) {
    const [item = "", price = ""] = entry.split("=");
    if (!(item in PRICES) || !PRICE.test(price)) {
      const items = Object.keys(PRICES).join(", ");
      throw new Error(
        `SKYWAKE_API_PRICES needs item=dollars, with items ${items}; not \`${entry}\``,
      );
    }
    set[item as Item] = price;
  }
  return set;
}

function billing(values: z.infer<typeof apiEnv>): BillingConfig | undefined {
  const mode = values.SKYWAKE_API_BILLING ?? (values.STRIPE_SECRET_KEY ? "stripe" : "off");
  if (mode === "off") return undefined;
  const secretKey = values.STRIPE_SECRET_KEY;
  const webhookSecret = values.STRIPE_WEBHOOK_SECRET;
  const publishableKey = values.STRIPE_PUBLISHABLE_KEY || null;
  const consoleUrl = values.SKYWAKE_API_CONSOLE_URL;
  const checkout = values.SKYWAKE_API_CHECKOUT;
  if (!secretKey || !webhookSecret || !consoleUrl) {
    throw new Error(
      "Stripe billing needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and SKYWAKE_API_CONSOLE_URL; " +
        "set SKYWAKE_API_BILLING=off to run without billing",
    );
  }
  if (checkout === "custom" && !publishableKey) {
    throw new Error("SKYWAKE_API_CHECKOUT=custom needs STRIPE_PUBLISHABLE_KEY");
  }
  if (/^[sr]k_live_/.test(secretKey) && values.SKYWAKE_API_BILLING_LIVE !== "true") {
    throw new Error("STRIPE_SECRET_KEY is a live key; set SKYWAKE_API_BILLING_LIVE=true to use it");
  }
  if (!/^[sr]k_(test|live)_/.test(secretKey)) {
    throw new Error("STRIPE_SECRET_KEY is not a Stripe secret or restricted key");
  }
  const live = /^[sr]k_live_/.test(secretKey);
  if (publishableKey && !new RegExp(`^pk_${live ? "live" : "test"}_`).test(publishableKey)) {
    throw new Error(
      `STRIPE_PUBLISHABLE_KEY must be a ${live ? "live" : "test"} key, like STRIPE_SECRET_KEY`,
    );
  }
  if (values.SKYWAKE_API_PRICES) {
    throw new Error("SKYWAKE_API_PRICES cannot be set with Stripe billing, whose prices are fixed");
  }
  return {
    secretKey,
    webhookSecret,
    checkout,
    publishableKey,
    consoleUrl: consoleUrl.replace(/\/+$/, ""),
  };
}

const provider = (url: string | undefined, key: string | undefined): Provider | undefined =>
  url ? { url: url.replace(/\/+$/, ""), key } : undefined;

function address(name: string, text: string) {
  const at = text.lastIndexOf(":");
  const port = Number(text.slice(at + 1));
  if (at < 0 || !Number.isInteger(port)) throw new Error(`${name} needs host:port`);
  return { hostname: text.slice(0, at), port };
}
