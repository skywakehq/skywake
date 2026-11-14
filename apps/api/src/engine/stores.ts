import { Engine, Index, type IndexOpenOptions, type StoreKeys } from "@skywake/engine";

import { badRequest } from "../http/errors.ts";
import type { Builds } from "./builds.ts";
import type { Leases } from "./leases.ts";

const OPEN_ENGINES = 1024;

/** A store this server does not serve as a region of its own, such as a customer's bucket. */
export interface OwnStore {
  store: string;
  keys?: StoreKeys;
}

/** Finds the store behind a region this server does not list itself, or null. */
export type FindStore = (region: string) => Promise<OwnStore | null>;

const WRITES: Record<string, number> = {
  alter: 0,
  restore: 0,
  dropAttributes: 0,
  merge: 0,
  upsert: 0,
  delete: 0,
  write: 0,
  deleteBranch: 0,
  fork: 1,
};

export class Stores {
  readonly #regions: Map<string, string>;
  readonly #own = new Map<string, OwnStore>();
  #find: FindStore | undefined;
  readonly #engines = new Map<string, Engine>();
  readonly #indexes = new Map<string, Index>();
  readonly #held = new Set<string>();
  // The region each open folder came from, so forgetting a region closes them.
  readonly #opened = new Map<string, string>();
  readonly #max: number;
  readonly #roots = new Map<string, Engine>();
  readonly #leases: Leases | undefined;
  readonly #heads: boolean;
  #builds: Builds | undefined;
  readonly defaultRegion: string;

  constructor(
    regions: [name: string, store: string][],
    max = OPEN_ENGINES,
    leases?: Leases,
    heads = false,
  ) {
    if (regions.length === 0) throw new Error("at least one region is needed");
    this.#regions = new Map(regions);
    this.#max = max;
    this.#leases = leases;
    this.#heads = heads;
    this.defaultRegion = regions[0]![0];
  }

  list() {
    return [...this.#regions.keys()].map((name) => ({
      name,
      default: name === this.defaultRegion,
    }));
  }

  /** Lets regions this server does not list (customer buckets) be found by `ready`. */
  findOwnStores(find: FindStore) {
    this.#find = find;
  }

  /** Whether the region is one of this server's own, not a customer's bucket. */
  serves(region: string) {
    return this.#regions.has(region);
  }

  /** Makes a customer's bucket usable under its region, before `location`, `engine` or `index`. */
  async ready(region: string) {
    if (this.#regions.has(region) || this.#own.has(region)) return;
    const found = this.#find ? await this.#find(region) : null;
    if (!found) throw new Error(`region \`${region}\` is not served here`);
    this.#own.set(region, found);
  }

  /** Forgets a customer's bucket, so the next `ready` reads it again. */
  forget(region: string) {
    this.#own.delete(region);
    for (const [folder, open] of this.#opened) if (open === region) this.#drop(folder);
  }

  keysOf(region: string): StoreKeys | undefined {
    return this.#own.get(region)?.keys;
  }

  pick(asked?: string) {
    const region = asked ?? this.defaultRegion;
    if (!this.#regions.has(region)) throw badRequest(`this server has no region \`${region}\``);
    return region;
  }

  location(region: string, folder: string) {
    const store = this.#regions.get(region) ?? this.#own.get(region)?.store;
    if (!store) throw new Error(`region \`${region}\` is not served here`);
    return inFolder(store, folder);
  }

  engine(region: string, folder: string): Engine {
    const heads = this.#heads && region === this.defaultRegion;
    const keys = this.keysOf(region);
    this.#opened.set(folder, region);
    return this.#reuse(this.#engines, folder, () =>
      Engine.open(this.location(region, folder), { heads, keys }),
    );
  }

  splitBuilds(builds: Builds) {
    this.#builds = builds;
  }

  index(region: string, folder: string, options?: IndexOpenOptions): Index {
    const cacheFolder = region === this.defaultRegion ? folder : undefined;
    const builds = this.#builds;
    const keys = this.keysOf(region);
    this.#opened.set(folder, region);
    return this.#reuse(this.#indexes, folder, () => {
      let index = Index.open(this.location(region, folder), {
        ...options,
        cacheFolder,
        builders: builds === undefined,
        keys,
      });
      if (builds) {
        const where = { region, folder, shards: options?.shards ?? 1, kmsKeyId: options?.kmsKeyId };
        index = built(index, (branch) => builds.written(where, branch));
      }
      return this.#leases ? leased(index, folder, this.#leases) : index;
    });
  }

  hold(folder: string) {
    this.#held.add(folder);
  }

  release(folder: string) {
    this.#held.delete(folder);
  }

  #drop(folder: string) {
    this.#engines.delete(folder);
    this.#indexes.delete(folder);
    this.#opened.delete(folder);
  }

  #reuse<T>(open: Map<string, T>, folder: string, make: () => T): T {
    let found = open.get(folder);
    if (found) {
      open.delete(folder);
    } else {
      found = make();
      if (open.size >= this.#max) {
        const oldest = [...open.keys()].find((key) => !this.#held.has(key));
        if (oldest !== undefined) open.delete(oldest);
      }
    }
    open.set(folder, found);
    return found;
  }

  async check() {
    for (const [region, store] of this.#regions) {
      try {
        let root = this.#roots.get(region);
        if (!root) this.#roots.set(region, (root = Engine.open(store)));
        await root.branches();
      } catch (error) {
        throw new Error(`the store of region \`${region}\` does not answer`, { cause: error });
      }
    }
  }
}

export function inFolder(store: string, folder: string) {
  const at = store.indexOf("?");
  const [path, settings] = at < 0 ? [store, ""] : [store.slice(0, at), store.slice(at)];
  return `${path.replace(/\/+$/, "")}/${folder}${settings}`;
}

const BUILT = new Set(["upsert", "delete", "write", "merge"]);

function built(index: Index, written: (branch: string) => void): Index {
  return new Proxy(index, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (typeof key !== "string" || !BUILT.has(key)) return value.bind(target);
      return async (...args: unknown[]) => {
        const result: unknown = await value.apply(target, args);
        written(args[0] as string);
        return result;
      };
    },
  });
}

function leased(index: Index, folder: string, leases: Leases): Index {
  return new Proxy(index, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (key === "multi") {
        return async (...args: Parameters<Index["multi"]>) => {
          const [branch, requests, options] = args;
          if (options?.eventual) return target.multi(branch, requests, options);
          const epoch = leases.epoch(folder, branch);
          return target.multi(branch, requests, { ...options, epoch });
        };
      }
      const at = typeof key === "string" ? WRITES[key] : undefined;
      if (at === undefined) return value.bind(target);
      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args);
        } finally {
          await leases.moved(folder, args[at] as string);
        }
      };
    },
  });
}
