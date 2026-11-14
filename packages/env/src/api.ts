import { z } from "zod";

export const apiEnv = z.object({
  SKYWAKE_API_DATABASE: z.string("needed: postgres://user:password@host/db").min(1),
  SKYWAKE_API_DATABASE_POOL: z.coerce.number().int().positive().default(16),
  SKYWAKE_STORE: z.string("needed: the default region's store, such as s3://bucket").min(1),
  SKYWAKE_API_REGION: z.string().default("local"),
  SKYWAKE_API_REGIONS: z.string().default(""),
  SKYWAKE_API_ADMIN_TOKEN: z.string().min(16, "at least 16 characters").optional(),
  SKYWAKE_API_JWKS_URL: z.url().optional(),
  SKYWAKE_API_JWT_ISSUER: z.string().min(1).optional(),
  SKYWAKE_API_JWT_AUDIENCE: z.string().min(1).optional(),
  SKYWAKE_API_LISTEN: z.string().default("0.0.0.0:8080"),
  SKYWAKE_API_METRICS_LISTEN: z.string().optional(),
  SKYWAKE_API_CORS_ORIGINS: z.string().default(""),
  SKYWAKE_API_RATE_LIMIT: z.coerce.number().int().min(0).default(1200),
  SKYWAKE_API_BODY_LIMIT_MB: z.coerce.number().positive().default(64),

  SKYWAKE_API_AUDIT_DAYS: z.coerce.number().int().min(0).default(365),
  // Where reads go in the audit trail: Postgres with everything else, or the server's log, for
  // fleets that read faster than one Postgres can take rows. Writes always go to Postgres.
  SKYWAKE_API_AUDIT_READS: z.enum(["database", "log"]).default("database"),
  // Warn at startup when the bucket or Postgres is in another region or far away.
  SKYWAKE_API_PLACEMENT_CHECK: z.enum(["true", "false"]).default("true"),

  SKYWAKE_API_TRUST_PROXY: z
    .string()
    .default("0")
    .transform((text) => (text === "true" ? 1 : text === "false" ? 0 : Number(text)))
    .pipe(z.number().int().min(0).max(10)),
  SKYWAKE_API_STS_ROLE_ARN: z.string().min(1).optional(),
  SKYWAKE_API_STS_ENDPOINT: z.url().optional(),
  SKYWAKE_API_STS_SECONDS: z.coerce.number().int().min(900).max(3600).default(900),
  // 32 random bytes in base64. Seals the keys of buckets customers bring, at rest in Postgres.
  SKYWAKE_API_SECRET_KEY: z.string().min(1).optional(),
  // The AWS principal (an account or role ARN) customers trust in the role of a bucket they bring.
  SKYWAKE_API_BYOB_PRINCIPAL: z.string().min(1).optional(),
  // `tier`: the cache servers own the default region's branch heads; they serve its whole bucket.
  SKYWAKE_HEADS: z.enum(["bucket", "tier"]).default("bucket"),
  SKYWAKE_CACHE_NODES: z.string().default(""),
  SKYWAKE_CACHE_TOKEN: z.string().optional(),
  SKYWAKE_API_EMBED_URL: z.url().optional(),
  SKYWAKE_API_EMBED_KEY: z.string().optional(),
  SKYWAKE_API_RERANK_URL: z.url().optional(),
  SKYWAKE_API_RERANK_KEY: z.string().optional(),
  SKYWAKE_API_PROVIDERS: z.string().default("{}"),
  SKYWAKE_API_PRICES: z.string().default(""),
  SKYWAKE_API_BILLING: z.enum(["off", "stripe"]).optional(),
  SKYWAKE_API_BILLING_LIVE: z.enum(["true", "false"]).default("false"),
  SKYWAKE_API_CONSOLE_URL: z.url().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  SKYWAKE_API_CHECKOUT: z.enum(["hosted", "custom"]).default("hosted"),
  SKYWAKE_API_PEER_URL: z.url().optional(),
  SKYWAKE_API_PEER_TOKEN: z.string().min(16, "at least 16 characters").optional(),
  AWS_ENDPOINT: z.string().optional(),
  AWS_ENDPOINT_URL: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_DEFAULT_REGION: z.string().optional(),
});
