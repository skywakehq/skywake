import { z } from "zod";

const needed = (what: string) => `needed: ${what}`;

/**
 * Settings only the hosted service uses: email, and sign-in with Google or
 * GitHub. All optional; with none set the console works as it always has.
 */
export const hostedEnv = z.object({
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.url().optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
});

export const consoleEnv = z
  .object({
    DATABASE_URL: z.string(needed("postgres://user:password@host/db")).min(1),
    BETTER_AUTH_URL: z.url(needed("where people reach the console")),
    BETTER_AUTH_SECRET: z.string(needed("openssl rand -hex 32")).min(32, "at least 32 characters"),
    SKYWAKE_API_URL: z.url(needed("the API, ending in /v1")),
    SKYWAKE_API_ADMIN_TOKEN: z
      .string(needed("openssl rand -hex 32"))
      .min(16, "at least 16 characters"),
    PUBLIC_ZERO_URL: z.url(needed("where browsers reach zero-cache")),
    PUBLIC_API_URL: z.url(needed("where agents reach the API")),
    SSO_PRIVATE_IDP_ORIGINS: z.string().default(""),
    SSO_VERIFIED_DOMAINS: z.string().default(""),
    TRUSTED_PROXIES: z.string().default(""),
    ...hostedEnv.shape,
  })
  .superRefine((env, ctx) => {
    if ((env.RESEND_API_KEY || env.SMTP_URL) && !env.EMAIL_FROM) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: needed("the sender, such as Skywake <hello@example.com>"),
      });
    }
    for (const provider of ["GOOGLE", "GITHUB"] as const) {
      const id = env[`${provider}_CLIENT_ID`];
      const secret = env[`${provider}_CLIENT_SECRET`];
      if (Boolean(id) !== Boolean(secret)) {
        ctx.addIssue({
          code: "custom",
          path: [id ? `${provider}_CLIENT_SECRET` : `${provider}_CLIENT_ID`],
          message: needed(
            `set both ${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET, or neither`,
          ),
        });
      }
    }
  });
