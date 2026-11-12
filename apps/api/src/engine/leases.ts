import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";

import type { Peer } from "../config.ts";
import type { Db } from "../db/client.ts";
import { indexLeases, peers } from "../db/schema.ts";
import { messageOf } from "../http/errors.ts";
import type { Log } from "../http/log.ts";
import { tellPeer } from "../http/peers.ts";

const LEASE_MS = 10_000;
const RENEW_MS = 2_000;
const MARGIN_MS = 1_000;
const IDLE_MS = 60_000;

const ms = (n: number) => sql`${n} * interval '1 millisecond'`;

export const MOVED_PATH = "/peer/moved";

interface Held {
  until: number;
  used: number;
  base: number;
  moved: Map<string, number>;
}

let epochs = 0;

export class Leases {
  readonly #db: Db;
  readonly #id: string;
  readonly #peer: Peer;
  readonly #log: Log;
  readonly #held = new Map<string, Held>();
  readonly #wanted = new Set<string>();
  #ticking: Promise<void> | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(db: Db, id: string, peer: Peer, log: Log) {
    this.#db = db;
    this.#id = id;
    this.#peer = peer;
    this.#log = log;
  }

  epoch(folder: string, branch: string): number | undefined {
    const held = this.#held.get(folder);
    const now = performance.now();
    if (!held || now >= held.until) {
      if (this.#peer.token !== undefined) this.#wanted.add(folder);
      return undefined;
    }
    held.used = now;
    return held.moved.get(branch) ?? held.base;
  }

  heard(folder: string, branch: string) {
    this.#held.get(folder)?.moved.set(branch, ++epochs);
  }

  async moved(folder: string, branch: string) {
    this.heard(folder, branch);
    let holders: { holder: string; url: string | null }[];
    try {
      holders = await this.#db
        .select({ holder: indexLeases.holder, url: peers.url })
        .from(indexLeases)
        .leftJoin(peers, eq(peers.id, indexLeases.holder))
        .where(
          and(
            eq(indexLeases.folder, folder),
            ne(indexLeases.holder, this.#id),
            eq(indexLeases.revoked, false),
            gt(indexLeases.expires, sql`now()`),
          ),
        );
    } catch (error) {
      this.#log({ level: "error", msg: "could not list read leases", error: messageOf(error) });
      await wait(LEASE_MS + MARGIN_MS);
      return;
    }
    if (holders.length === 0) return;
    const told = await Promise.all(
      holders.map((holder) => tell(holder.url, this.#peer.token, folder, branch)),
    );
    const silent = holders.filter((_, i) => !told[i]).map((holder) => holder.holder);
    if (silent.length > 0) await this.#revoke(folder, silent);
  }

  start() {
    const tick = () =>
      void this.tick().catch((error: unknown) =>
        this.#log({ level: "warn", msg: "read leases failed", error: messageOf(error) }),
      );
    this.#timer = setInterval(tick, RENEW_MS);
  }

  async stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#held.clear();
    await this.#db.delete(indexLeases).where(eq(indexLeases.holder, this.#id));
  }

  async tick() {
    this.#ticking ??= this.#tick().finally(() => (this.#ticking = null));
    await this.#ticking;
  }

  async #tick() {
    const me = this.#id;
    const now = performance.now();
    const idle = [...this.#held].filter(([, held]) => now - held.used > IDLE_MS).map(([f]) => f);
    for (const folder of idle) this.#held.delete(folder);
    if (idle.length > 0) {
      await this.#db
        .delete(indexLeases)
        .where(and(eq(indexLeases.holder, me), inArray(indexLeases.folder, idle)));
    }

    const kept = [...this.#held.keys()];
    if (kept.length > 0) {
      const started = performance.now();
      const renewed = await this.#db
        .update(indexLeases)
        .set({ expires: sql`now() + ${ms(LEASE_MS)}` })
        .where(
          and(
            eq(indexLeases.holder, me),
            inArray(indexLeases.folder, kept),
            eq(indexLeases.revoked, false),
            gt(indexLeases.expires, sql`now()`),
          ),
        )
        .returning({ folder: indexLeases.folder });
      const still = new Set(renewed.map((row) => row.folder));
      for (const folder of kept) {
        const held = this.#held.get(folder);
        if (!held) continue;
        if (still.has(folder)) held.until = started + LEASE_MS - MARGIN_MS;
        else this.#held.delete(folder);
      }
    }

    const wanted = [...this.#wanted].filter((folder) => !this.#held.has(folder));
    this.#wanted.clear();
    if (wanted.length > 0) {
      const started = performance.now();
      const taken = await this.#db
        .insert(indexLeases)
        .values(
          wanted.map((folder) => ({ folder, holder: me, expires: sql`now() + ${ms(LEASE_MS)}` })),
        )
        .onConflictDoUpdate({
          target: [indexLeases.folder, indexLeases.holder],
          set: { expires: sql`excluded.expires`, revoked: false },
        })
        .returning({ folder: indexLeases.folder });
      for (const { folder } of taken) {
        this.#held.set(folder, {
          until: started + LEASE_MS - MARGIN_MS,
          used: started,
          base: ++epochs,
          moved: new Map(),
        });
      }
    }
  }

  async #revoke(folder: string, holders: string[]) {
    const revoked = await this.#db
      .update(indexLeases)
      .set({ revoked: true })
      .where(and(eq(indexLeases.folder, folder), inArray(indexLeases.holder, holders)))
      .returning({
        left: sql<number>`greatest(0, extract(epoch from ${indexLeases.expires} - now()) * 1000)`,
      });
    const left = Math.max(0, ...revoked.map((row) => Number(row.left)));
    this.#log({ level: "warn", msg: "read lease holders did not answer", folder, holders });
    await wait(left + MARGIN_MS);
  }
}

function tell(url: string | null, token: string | undefined, folder: string, branch: string) {
  if (!url || token === undefined) return Promise.resolve(false);
  return tellPeer(url, MOVED_PATH, token, { folder, branch });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
