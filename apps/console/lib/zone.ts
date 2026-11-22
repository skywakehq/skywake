/**
 * Where the console lives on its host: the root by default, or a path such
 * as `/dashboard` when it sits behind the site (scripts/dev.sh). Read at
 * build time; `next.config.ts` inlines it for the browser too.
 */
export const basePath = process.env.CONSOLE_BASE_PATH ?? "";

/** A console address for fetch and location. Next's Link, router and
 *  redirect add the base path themselves. */
export const withBase = (path: string) => basePath + path;

/**
 * A `next` to go to after signing in, kept to a path on this console: anything
 * else (`//evil.example`, `/\evil`, `javascript:…`) becomes the home page. Browsers
 * drop tabs and newlines from URLs, so `/<tab>/evil.example` is refused too.
 */
export const safeNext = (next: string | null) =>
  next && /^\/(?![/\\])/.test(next) && !/[\s\x00-\x1f]/.test(next) ? next : "/";
