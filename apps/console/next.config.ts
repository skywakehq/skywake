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
  // pg is a Node package; keep it out of the server bundle.
  serverExternalPackages: ["pg"],
};

export default config;
