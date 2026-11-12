import { randomBytes, timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";

import type { Peer } from "../../config.ts";
import type { Db } from "../../db/client.ts";
import type { Stores } from "../../engine/stores.ts";
import { messageOf } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";
import type { IndexRow } from "../indexes/queries.ts";
import type { IndexUsage } from "../indexes/usage.ts";
import { Keeper } from "./keeper.ts";
import { place } from "./placement.ts";
import * as peers from "./queries.ts";

const BEAT_MS = 2000;
const LIVE_MS = 10_000;

const keyOf = (org: string, name: string) => `${org}\0${name}`;

export const serverId = () => `${hostname()}-${randomBytes(3).toString("hex")}`;

export class Pinning {
  readonly id: string;
  readonly #db: Db;
  readonly #peer: Peer;
  readonly #keeper: Keeper;
  readonly #usage: IndexUsage;
  readonly #log: Log;
  #pinned = new Map<string, peers.PinnedRow>();
  #placed = new Map<string, peers.PeerRow[]>();
  #live: peers.PeerRow[] = [];
  readonly #inFlight = new Map<string, number>();
  readonly #sending = new Map<string, number>();
  #beaten: number | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(id: string, db: Db, peer: Peer, stores: Stores, usage: IndexUsage, log: Log) {
    this.id = id;
    this.#db = db;
    this.#peer = peer;
    this.#usage = usage;
    this.#log = log;
    this.#keeper = new Keeper(stores, usage, log);
  }

  start() {
    const tick = () =>
      void this.tick().catch((error: unknown) =>
        this.#log({ level: "warn", msg: "pinning heartbeat failed", error: messageOf(error) }),
      );
    this.#timer = setInterval(tick, BEAT_MS);
    tick();
  }

  async stop() {
    if (this.#timer) clearInterval(this.#timer);
    await peers.forget(this.#db, this.id);
  }

  async tick() {
    const now = Date.now();
    const held = this.#beaten === null ? 0 : Math.min(now - this.#beaten, LIVE_MS);
    this.#beaten = now;
    await peers.beat(this.#db, { id: this.id, url: this.#peer.url, serving: this.#serving() });
    const [live, pinned] = await Promise.all([
      peers.live(this.#db, LIVE_MS),
      peers.pinnedIndexes(this.#db),
    ]);
    this.#live = live;
    this.#pinned = new Map(pinned.map((row) => [keyOf(row.org, row.name), row]));
    this.#placed = new Map(
      pinned.map((row) => [row.folder, place(row.folder, live, row.replicas!)]),
    );
    const mine = pinned.filter((row) => this.holds(row.folder));
    for (const row of mine) this.#usage.pinned(row.org, row.name, held);
    await this.#keeper.keep(mine);
  }

  live() {
    return this.#live;
  }

  pinned(org: string, name: string) {
    return this.#pinned.get(keyOf(org, name));
  }

  holds(folder: string) {
    return this.#placed.get(folder)?.some((peer) => peer.id === this.id) ?? false;
  }

  get token() {
    return this.#peer.token;
  }

  admits(token: string | undefined) {
    const own = this.#peer.token;
    if (own === undefined || token === undefined) return false;
    const [a, b] = [Buffer.from(token), Buffer.from(own)];
    return a.length === b.length && timingSafeEqual(a, b);
  }

  others(folder: string) {
    const load = (peer: peers.PeerRow) =>
      (peer.serving[folder]?.in_flight ?? 0) + (this.#sending.get(peer.id) ?? 0);
    return (this.#placed.get(folder) ?? [])
      .filter((peer) => peer.id !== this.id)
      .sort((a, b) => load(a) - load(b));
  }

  async answer<T>(folder: string, work: () => Promise<T>) {
    return this.#counted(this.#inFlight, folder, work);
  }

  async send<T>(peer: string, work: () => Promise<T>) {
    return this.#counted(this.#sending, peer, work);
  }

  status(index: Pick<IndexRow, "folder" | "pinnedReplicas">) {
    if (index.pinnedReplicas === null) return null;
    const placed =
      this.#placed.get(index.folder) ?? place(index.folder, this.#live, index.pinnedReplicas);
    const replicas = placed.map((peer) => {
      const own = peer.id === this.id;
      const serving = peer.serving[index.folder];
      return {
        server: peer.id,
        warm: own ? this.#keeper.isWarm(index.folder) : (serving?.warm ?? false),
        in_flight: own ? (this.#inFlight.get(index.folder) ?? 0) : (serving?.in_flight ?? 0),
      };
    });
    return { replicas };
  }

  #serving(): peers.Serving {
    const serving: peers.Serving = {};
    for (const [folder, placed] of this.#placed) {
      if (!placed.some((peer) => peer.id === this.id)) continue;
      const in_flight = this.#inFlight.get(folder) ?? 0;
      serving[folder] = { warm: this.#keeper.isWarm(folder), in_flight };
    }
    return serving;
  }

  async #counted<T>(counts: Map<string, number>, key: string, work: () => Promise<T>) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    try {
      return await work();
    } finally {
      const left = counts.get(key)! - 1;
      if (left === 0) counts.delete(key);
      else counts.set(key, left);
    }
  }
}
