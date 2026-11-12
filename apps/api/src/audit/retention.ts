import type { Db } from "../db/client.ts";
import { withLease } from "../db/leases.ts";
import type { Log } from "../http/log.ts";
import { prune } from "./store.ts";

const EVERY_MS = 60 * 60 * 1000;

export function keepFor(db: Db, days: number, log: Log) {
  if (days === 0) return () => {};
  const run = () =>
    withLease(db, "audit-retention", () => prune(db, days), { log })
      .then(
        (deleted) =>
          deleted > 0 && log({ level: "info", msg: "audit events pruned", deleted, days }),
      )
      .catch((error: unknown) =>
        log({ level: "warn", msg: "audit prune failed", error: String(error) }),
      );
  const timer = setInterval(run, EVERY_MS).unref();
  void run();
  return () => clearInterval(timer);
}
