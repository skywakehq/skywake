import { BlockList, isIP } from "node:net";

import { eq } from "drizzle-orm";

import type { Changes } from "../../db/changes.ts";
import type { Db } from "../../db/client.ts";
import { orgs } from "../../db/schema.ts";
import { HttpError, invalidAt } from "../../http/errors.ts";

const FRESH_MS = 5000;
/** While Postgres sends notices of changes, a list is kept this long. */
const NOTICED_MS = 30_000;

const family = (address: string) => (isIP(address) === 6 ? "ipv6" : "ipv4");

export const plainAddress = (address: string) =>
  address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");

function parse(cidr: string) {
  const [address = "", bits, extra] = cidr.split("/");
  const version = isIP(address);
  const most = version === 6 ? 128 : 32;
  const prefix = bits === undefined ? most : Number(bits);
  if (!version || extra !== undefined || !/^\d+$/.test(bits ?? "0") || prefix > most) return null;
  return { address, prefix };
}

export function checked(cidrs: string[]) {
  cidrs.forEach((cidr, i) => {
    if (!parse(cidr)) {
      throw invalidAt(`cidrs[${i}]`, "use a CIDR such as 203.0.113.0/24 or 2001:db8::/32");
    }
  });
  return [...new Set(cidrs)];
}

function blockList(cidrs: string[]) {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const { address, prefix } = parse(cidr)!;
    list.addSubnet(address, prefix, family(address));
  }
  return list;
}

export function lets(cidrs: string[], address: string) {
  return cidrs.length === 0 || within(blockList(cidrs), address);
}

function within(list: BlockList, address: string) {
  const plain = plainAddress(address);
  return isIP(plain) !== 0 && list.check(plain, family(plain));
}

export const notAllowed = (address: string) =>
  new HttpError(
    403,
    `this organization does not take calls from ${address}; an admin can add it to the IP allowlist`,
    undefined,
    "ip_not_allowed",
  );

export class Allowlists {
  readonly #db: Db;
  readonly #read = new Map<string, { at: number; cidrs: string[]; list: BlockList }>();
  readonly #changes: Changes | null;

  constructor(db: Db, changes?: Changes) {
    this.#db = db;
    this.#changes = changes ?? null;
    changes?.on((change) => {
      if (change === null) this.#read.clear();
      else if (change.table === "orgs" && change.org) this.#read.delete(change.org);
    });
  }

  async get(org: string) {
    return (await this.#entry(org)).cidrs;
  }

  async set(org: string, cidrs: string[]) {
    await this.#db.update(orgs).set({ ipAllowlist: cidrs }).where(eq(orgs.id, org));
    this.#read.delete(org);
  }

  async check(org: string, address: string) {
    const { cidrs, list } = await this.#entry(org);
    if (cidrs.length > 0 && !within(list, address)) throw notAllowed(address);
  }

  async #entry(org: string) {
    const found = this.#read.get(org);
    const fresh = this.#changes?.listening ? NOTICED_MS : FRESH_MS;
    if (found && Date.now() - found.at < fresh) return found;
    const [row] = await this.#db
      .select({ cidrs: orgs.ipAllowlist })
      .from(orgs)
      .where(eq(orgs.id, org))
      .limit(1);
    const cidrs = row?.cidrs ?? [];
    const entry = { at: Date.now(), cidrs, list: blockList(cidrs) };
    this.#read.set(org, entry);
    return entry;
  }
}
