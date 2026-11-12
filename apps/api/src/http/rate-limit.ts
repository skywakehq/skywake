import { isIPv6 } from "node:net";

import { getConnInfo } from "@hono/node-server/conninfo";
import { lt, sql } from "drizzle-orm";
import type { Context } from "hono";

import type { Db } from "../db/client.ts";
import { rateLimits } from "../db/schema.ts";
import { HttpError } from "./errors.ts";
import { CLIENT_HEADER } from "./peers.ts";

const WINDOW_MS = 60_000;
const SYNC_MS = 1000;
const BATCH = 5000;

interface Count {
  window: number;
  shared: number;
  local: number;
}

export class RateLimiter {
  readonly #db: Db;
  readonly #limit: number;
  readonly #counts = new Map<string, Count>();
  #purged = -1;
  #timer: NodeJS.Timeout | null = null;
  #syncing: Promise<void> | null = null;

  constructor(db: Db, limit: number) {
    this.#db = db;
    this.#limit = limit;
  }

  start() {
    this.#timer = setInterval(() => void this.sync().catch(() => {}), SYNC_MS);
    this.#timer.unref();
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
  }

  async hit(c: Context, client: string) {
    const now = Date.now();
    const window = Math.floor(now / WINDOW_MS);
    let counted = this.#counts.get(client);
    if (!counted || counted.window !== window) {
      counted = { window, shared: 0, local: 0 };
      this.#counts.set(client, counted);
    }
    counted.local++;
    const count = counted.shared + counted.local;

    const remaining = Math.max(0, this.#limit - count);
    const reset = Math.ceil(((window + 1) * WINDOW_MS - now) / 1000);
    const shown = c.get("rateLimitRemaining") as number | undefined;
    if (shown === undefined || remaining <= shown) {
      c.set("rateLimitRemaining", remaining);
      c.header("RateLimit-Limit", String(this.#limit));
      c.header("RateLimit-Remaining", String(remaining));
      c.header("RateLimit-Reset", String(reset));
    }
    if (count > this.#limit) {
      c.header("Retry-After", String(reset));
      throw new HttpError(429, "too many requests; slow down");
    }
  }

  async sync() {
    this.#syncing ??= this.#sync().finally(() => (this.#syncing = null));
    await this.#syncing;
  }

  async #sync() {
    const window = Math.floor(Date.now() / WINDOW_MS);
    if (window !== this.#purged) {
      this.#purged = window;
      await this.#db.delete(rateLimits).where(lt(rateLimits.window, window - 1));
    }
    for (const [client, counted] of this.#counts) {
      if (counted.window !== window) this.#counts.delete(client);
    }
    // Clients with nothing new are sent too, to read back what other processes added.
    const sent = [...this.#counts].map(([client, counted]) => ({
      client,
      window,
      count: counted.local,
    }));
    for (let at = 0; at < sent.length; at += BATCH) {
      await this.#send(window, sent.slice(at, at + BATCH));
    }
  }

  async #send(window: number, sent: { client: string; window: number; count: number }[]) {
    for (const { client, count } of sent) this.#counts.get(client)!.local -= count;
    try {
      const totals = await this.#db
        .insert(rateLimits)
        .values(sent)
        .onConflictDoUpdate({
          target: rateLimits.client,
          set: {
            count: sql`CASE WHEN ${rateLimits.window} = excluded.window THEN ${rateLimits.count} + excluded.count ELSE excluded.count END`,
            window: sql`excluded.window`,
          },
        })
        .returning({ client: rateLimits.client, count: rateLimits.count });
      for (const { client, count } of totals) {
        const counted = this.#counts.get(client);
        if (counted?.window === window) counted.shared = count;
      }
    } catch (error) {
      for (const { client, count } of sent) {
        const counted = this.#counts.get(client);
        if (counted?.window === window) counted.local += count;
      }
      throw error;
    }
  }
}

export const clientOf = (c: Context, hops: number) => {
  const address = clientAddress(c, hops);
  return address === "unknown" ? address : addressGroup(address);
};

export function clientAddress(c: Context, hops: number) {
  if (c.get("fromPeer")) return c.req.header(CLIENT_HEADER) ?? "unknown";
  if (hops > 0) {
    const chain = (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (chain.length >= hops) return chain[chain.length - hops]!;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function addressGroup(address: string) {
  const plain = address.split("%")[0]!;
  if (!isIPv6(plain)) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(plain);
  if (mapped) return mapped[1]!;
  const groups = (part: string) =>
    part ? part.split(":").flatMap((group) => (group.includes(".") ? ["0", "0"] : [group])) : [];
  const [left = "", right] = plain.split("::");
  const known = groups(left);
  const tail = right === undefined ? [] : groups(right);
  const all = [...known, ...Array(8 - known.length - tail.length).fill("0"), ...tail];
  return `${all
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}
