import { indexes } from "@skywake/contract";
import type { Index } from "@skywake/engine";

import { place } from "../features/pinning/placement.ts";
import { messageOf } from "../http/errors.ts";
import type { Log } from "../http/log.ts";
import { tellPeer } from "../http/peers.ts";
import type { Stores } from "./stores.ts";

export const BUILD_PATH = "/peer/build";

const IDLE_MS = 60_000;
const AGAIN_MS = 5_000;
const RESYNC_MS = 10_000;

export interface BuildOrder {
  region: string;
  folder: string;
  shards: number;
  kmsKeyId?: string;
  branch: string;
  build: number[];
}

interface Building {
  order: BuildOrder;
  index: Index;
  last: number;
  synced: number;
}

interface Live {
  id: string;
  url: string;
}

const keyOf = (...parts: (string | number)[]) => parts.join("\0");

function split(id: string, live: Live[], folder: string, branch: string, shards: number) {
  const mine: number[] = [];
  const theirs = new Map<string, { peer: Live; build: number[] }>();
  for (let shard = 0; shard < shards; shard++) {
    const [owner] = place(keyOf(folder, branch, shard), live, 1);
    if (!owner || owner.id === id) {
      mine.push(shard);
      continue;
    }
    const found = theirs.get(owner.id) ?? { peer: owner, build: [] };
    found.build.push(shard);
    theirs.set(owner.id, found);
  }
  return { mine, theirs };
}

export class Builds {
  readonly #id: string;
  readonly #token: string;
  readonly #live: () => Live[];
  readonly #stores: Stores;
  readonly #log: Log;
  readonly #building = new Map<string, Building>();
  readonly #told = new Map<string, number>();
  #timer: NodeJS.Timeout | null = null;

  constructor(id: string, token: string, live: () => Live[], stores: Stores, log: Log) {
    this.#id = id;
    this.#token = token;
    this.#live = live;
    this.#stores = stores;
    this.#log = log;
  }

  start() {
    this.#timer = setInterval(() => void this.tidy(), IDLE_MS / 4);
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
  }

  written(where: Omit<BuildOrder, "branch" | "build">, branch: string) {
    const { mine, theirs } = split(this.#id, this.#live(), where.folder, branch, where.shards);
    if (mine.length > 0) void this.build({ ...where, branch, build: mine });
    const now = Date.now();
    for (const { peer, build } of theirs.values()) {
      const key = keyOf(peer.id, where.folder, branch);
      if (now - (this.#told.get(key) ?? 0) < AGAIN_MS) continue;
      this.#told.set(key, now);
      const order = { ...where, branch, build };
      void tellPeer(peer.url, BUILD_PATH, this.#token, order).then((told) => {
        if (!told) void this.build(order);
      });
    }
  }

  async build(order: BuildOrder) {
    const key = keyOf(order.folder, order.branch);
    const { region, folder, shards, kmsKeyId } = order;
    const index = this.#stores.index(region, folder, { shards, kmsKeyId });
    const was = this.#building.get(key);
    const build = [...new Set([...(was?.order.build ?? []), ...order.build])].sort((a, b) => a - b);
    const now = Date.now();
    const same =
      was?.index === index &&
      was.order.build.length === build.length &&
      now - was.synced < RESYNC_MS;
    const synced = same ? was.synced : now;
    this.#building.set(key, { order: { ...order, build }, index, last: now, synced });
    if (same) return;
    try {
      await index.buildShards(order.branch, build);
    } catch (error) {
      this.#log({
        level: "warn",
        msg: "index builders not started",
        folder,
        error: messageOf(error),
      });
    }
  }

  async tidy() {
    const now = Date.now();
    for (const [key, building] of this.#building) {
      if (now - building.last < IDLE_MS) continue;
      const left = await building.index
        .stats(building.order.branch)
        .then((stats) => stats.unindexedRows)
        .catch(() => 0);
      if (left > 0) {
        building.last = now;
        continue;
      }
      this.#building.delete(key);
      await building.index.buildShards(building.order.branch, []).catch(() => {});
    }
    for (const [key, at] of this.#told) if (now - at >= AGAIN_MS) this.#told.delete(key);
  }

  building(folder: string, branch: string) {
    return this.#building.get(keyOf(folder, branch))?.order.build ?? [];
  }
}

export function orderOf(body: unknown): BuildOrder | null {
  const order = body as Partial<BuildOrder> | null;
  if (
    typeof order?.region !== "string" ||
    typeof order.folder !== "string" ||
    typeof order.branch !== "string" ||
    !Number.isInteger(order.shards) ||
    order.shards! < 1 ||
    order.shards! > indexes.SHARDS_MAX ||
    !Array.isArray(order.build) ||
    !order.build.every((shard) => Number.isInteger(shard) && shard >= 0 && shard < order.shards!)
  ) {
    return null;
  }
  const kmsKeyId = typeof order.kmsKeyId === "string" ? order.kmsKeyId : undefined;
  return { ...(order as BuildOrder), kmsKeyId };
}
