import "@skywake/env/load";

import type { NextConfig } from "next";
import { basePath } from "./lib/zone";

const config: NextConfig = {
  // A standalone server for the Docker image, traced from the repository root.
  output: "standalone",
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  basePath,
  // Behind the site, this zone's `/_next` files get a prefix of their own so
  // they don't clash with the site's.
  assetPrefix: basePath ? `${basePath}-static` : undefined,
  env: { CONSOLE_BASE_PATH: basePath },
  transpilePackages: ["@skywake/ui"],
  // The share images read their fonts from @skywake/ui.
  outputFileTracingIncludes: { "/**": ["../../packages/ui/src/og/fonts/*"] },
  // pg is a Node package; keep it out of the server bundle.
  serverExternalPackages: ["pg"],
  // No page may be framed: a framed "Approve" or "Make key" button could be clicked
  // through a decoy. Links out send only the origin, never a sign-in code or invite.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
