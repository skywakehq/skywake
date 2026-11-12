/**
 * Where the console lives on its host: the root by default, or a path such
 * as `/dashboard` when it sits behind the site (scripts/dev.sh). Read at
 * build time; `next.config.ts` inlines it for the browser too.
 */
export const basePath = process.env.CONSOLE_BASE_PATH ?? "";

/** A console address for fetch and location. Next's Link, router and
 *  redirect add the base path themselves. */
export const withBase = (path: string) => basePath + path;
