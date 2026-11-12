import "@skywake/env/load";

import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import { basePath } from "./lib/zone";

const config: NextConfig = {
  // A standalone server for the Docker image, traced from the repository root.
  output: "standalone",
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  // The search index reads the API's document when it starts.
  outputFileTracingIncludes: { "/api/search": ["../../packages/contract/generated/openapi.json"] },
  basePath,
  // Behind another app, this zone's `/_next` files must not clash with that
  // app's: they get a prefix of their own, which this server also answers.
  assetPrefix: process.env.DOCS_ASSET_PREFIX ?? (basePath ? `${basePath}-static` : undefined),
  // Inlined, so the browser sees the same base path as the server.
  env: { DOCS_BASE_PATH: basePath, SITE_URL: process.env.SITE_URL ?? "https://skywake.dev" },
  // Any page as Markdown: `/indexes/write.md`.
  async rewrites() {
    return [{ source: "/:path*.md", destination: "/llms.mdx/:path*" }];
  },
  transpilePackages: ["@skywake/ui"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default createMDX()(config);
