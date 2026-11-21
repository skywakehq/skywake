/**
 * Where the docs live on their host. `/docs` behind the site's domain; set
 * `DOCS_BASE_PATH=` (empty) to serve them at the root of their own host.
 * Read at build time; `next.config.ts` inlines it for the browser too.
 */
export const basePath = process.env.DOCS_BASE_PATH ?? "/docs";

const siteUrl = (process.env.SITE_URL ?? "https://skywake.dev").replace(/\/$/, "");

/** A docs path as a full URL, `/filesystem/branches` to `https://skywake.dev/docs/filesystem/branches`. */
export const absoluteUrl = (path: string) => `${siteUrl}${basePath}${path === "/" ? "" : path}`;
