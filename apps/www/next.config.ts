import "@skywake/env/load";

import type { NextConfig } from "next";
import { zoneRewrites } from "./lib/rewrites";

const docs = { url: process.env.DOCS_URL, path: process.env.DOCS_BASE_PATH || "/docs" };
const dashboard = {
  url: process.env.CONSOLE_URL,
  path: process.env.CONSOLE_BASE_PATH || "/dashboard",
};

const docsLink = process.env.DOCS_LINK ?? (docs.url ? docs.path : "https://skywake.dev/docs");
// With no console zone wired up (local dev), buttons still point at where it would live.
const consoleLink = process.env.CONSOLE_LINK ?? dashboard.path;
const siteUrl = process.env.SITE_URL ?? "https://skywake.dev";

const nextConfig: NextConfig = {
  transpilePackages: ["@skywake/ui"],
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  cacheComponents: true,
  // app/global-not-found.tsx: the 404 for URLs outside any language.
  experimental: { globalNotFound: true },
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
    // Skywake Cloud: on by default, linking to the console; `0` shows the waitlist instead.
    CLOUD_OPEN: process.env.CLOUD_OPEN ?? "1",
  },
  async redirects() {
    return [
      {
        source: "/:locale(en|de|es|fr|it)/:page(filesystem|search|benchmarks)",
        destination: "/:locale",
        permanent: true,
      },
      { source: "/:page(filesystem|search|benchmarks)", destination: "/", permanent: true },
    ];
  },
  async rewrites() {
    return [docs, dashboard].flatMap((zone) => (zone.url ? zoneRewrites(zone.path, zone.url) : []));
  },
};

export default nextConfig;
