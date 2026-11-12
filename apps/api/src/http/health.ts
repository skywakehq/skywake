import { sql } from "drizzle-orm";
import type { Hono } from "hono";

import type { AppEnv, Services } from "./context.ts";

const READY_MS = 3000;
const READY_CACHE_MS = 5000;

export function healthRoutes(app: Hono<AppEnv>, services: Services) {
  app.get("/health", (c) => c.json({ ok: true }));
  const readiness = async () => {
    const failed: string[] = [];
    await Promise.all([
      within(services.db.execute(sql`SELECT 1`)).catch(() => failed.push("database")),
      within(services.stores.check()).catch(() => failed.push("store")),
    ]);
    if (failed.length > 0) services.log({ level: "warn", msg: "not ready", failed });
    return failed;
  };
  let last: { at: number; failed: Promise<string[]> } | undefined;
  app.get("/ready", async (c) => {
    if (!last || Date.now() - last.at > READY_CACHE_MS) {
      last = { at: Date.now(), failed: readiness() };
    }
    const failed = await last.failed;
    return c.json({ ok: failed.length === 0, failed }, failed.length === 0 ? 200 : 503);
  });
}

function within<T>(work: Promise<T>) {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), READY_MS).unref(),
    ),
  ]);
}
