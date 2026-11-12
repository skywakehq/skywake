import "@skywake/env/load";

import type { NextConfig } from "next";
import { zoneRewrites } from "./lib/rewrites";

const docs = { url: process.env.DOCS_URL, path: process.env.DOCS_BASE_PATH || "/docs" };
const dashboard = {
  url: process.env.CONSOLE_URL,
  path: process.env.CONSOLE_BASE_PATH || "/dashboard",
};

const docsLink = process.env.DOCS_LINK ?? (docs.url ? docs.path : "https://skywake.dev/docs");
const consoleLink = process.env.CONSOLE_LINK ?? (dashboard.url ? dashboard.path : "");
const siteUrl = process.env.SITE_URL ?? "https://skywake.dev";

const nextConfig: NextConfig = {
  transpilePackages: ["@skywake/ui"],
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  env: {
    DOCS_LINK: docsLink,
    CONSOLE_LINK: consoleLink,
    SITE_URL: siteUrl,
    // Skywake Cloud: off shows the waitlist, on (`1`) links to the console.
    CLOUD_OPEN: process.env.CLOUD_OPEN ?? "",
  },
  async rewrites() {
    return [docs, dashboard].flatMap((zone) => (zone.url ? zoneRewrites(zone.path, zone.url) : []));
  },
};

export default nextConfig;
