import type { Db } from "../../db/client.ts";
import { HttpError } from "../../http/errors.ts";
import {
  type Feature,
  has,
  type Limit,
  limitOf,
  lowestPlanWith,
  type Meter,
  PLAN,
  type Plan,
  shown,
} from "./catalog.ts";
import type { Ledger } from "./ledger.ts";
import * as billing from "./queries.ts";
import { type Account, standing } from "./standing.ts";

const ACCOUNT_MS = 10_000;
const USAGE_MS = 10_000;
const STORED_MS = 60_000;

class Cache<T> {
  readonly #ttl: number;
  readonly #entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(ttl: number) {
    this.#ttl = ttl;
  }

  get(key: string, load: () => Promise<T>) {
    const found = this.#entries.get(key);
    if (found && performance.now() - found.at < this.#ttl) return found.value;
    const value = load();
    this.#entries.set(key, { at: performance.now(), value });
    value.catch(() => this.#entries.delete(key));
    return value;
  }

  drop(key: string) {
    this.#entries.delete(key);
  }
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

const FEATURE_NAME: Record<Feature, string> = {
  pinning: "Pinned replicas",
  sso: "Single sign-on",
  audit_log: "The audit log",
  ip_allowlist: "IP allowlists",
  customer_keys: "Customer-managed keys",
};

const LIMIT_NAME: Record<Limit, (amount: string) => string> = {
  stored: (n) => `${n} GB of index storage`,
  storage: (n) => `${n} GB-months of storage`,
  writes: (n) => `${n} GB of writes a month`,
  queries: (n) => `${n} TB of queries scanned a month`,
  embeddings: (n) => `${n} embedded texts a month`,
  reranks: (n) => `${n} reranked documents a month`,
  pinned: (n) => `${n} GB-hours of pinned replicas a month`,
  indexes: (n) => `${n} indexes`,
  files_stored: (n) => `${n} GB of files`,
  files_storage: (n) => `${n} GB-months of files`,
  files_egress: (n) => `${n} GB of file downloads a month`,
  filesystems: (n) => `${n} filesystems`,
};

const GiB = 1n << 30n;

function amountOf(limit: Limit, value: bigint) {
  if (limit === "stored" || limit === "files_stored") {
    return shownNumber(Number(value) / Number(GiB));
  }
  if (limit === "indexes" || limit === "filesystems") return value.toString();
  return shownNumber(shown(limit, value));
}

const shownNumber = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export class Gate {
  readonly #db: Db;
  readonly #ledger: Ledger;
  readonly #upgradeUrl: string;
  readonly #now: () => Date;
  readonly #accounts = new Cache<Account | null>(ACCOUNT_MS);
  readonly #usage = new Cache<Map<Meter, bigint>>(USAGE_MS);
  readonly #stored = new Cache<bigint>(STORED_MS);
  readonly #files = new Cache<bigint>(STORED_MS);

  constructor(db: Db, ledger: Ledger, upgradeUrl: string, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#ledger = ledger;
    this.#upgradeUrl = upgradeUrl;
    this.#now = now;
  }

  account(org: string) {
    return this.#accounts.get(org, () => billing.account(this.#db, org));
  }

  async plan(org: string): Promise<Plan> {
    return standing(await this.account(org), this.#now());
  }

  forget(org: string) {
    this.#accounts.drop(org);
    this.#usage.drop(org);
    this.#stored.drop(org);
    this.#files.drop(org);
  }

  async require(org: string, feature: Feature) {
    const plan = await this.plan(org);
    if (has(plan, feature)) return;
    const needed = PLAN[lowestPlanWith(feature)].name;
    throw this.#refusal(
      `${FEATURE_NAME[feature]} needs the ${needed} plan; this organization is on ${PLAN[plan].name}.`,
    );
  }

  async admit(org: string, meter: Meter) {
    const plan = await this.plan(org);
    if (meter === "writes") await this.#within(plan, "stored", () => this.#storedOf(org));
    if (meter === "pinned") return this.require(org, "pinning");
    await this.#within(plan, meter, async () => (await this.usage(org)).get(meter) ?? 0n);
  }

  async admitIndex(org: string) {
    const plan = await this.plan(org);
    await this.#within(plan, "indexes", () => billing.indexCount(this.#db, org));
  }

  async admitFilesystem(org: string) {
    const plan = await this.plan(org);
    await this.#within(plan, "filesystems", () => billing.filesystemCount(this.#db, org));
  }

  async admitFiles(org: string) {
    const plan = await this.plan(org);
    await this.#within(plan, "files_stored", () =>
      this.#files.get(org, () => billing.filesStored(this.#db, org)),
    );
  }

  async usage(org: string) {
    const from = monthStart(this.#now());
    const saved = await this.#usage.get(org, () => billing.usageSince(this.#db, org, from));
    const totals = new Map(saved);
    for (const [meter, amount] of this.#ledger.pendingFor(org, from)) {
      totals.set(meter, (totals.get(meter) ?? 0n) + amount);
    }
    return totals;
  }

  #storedOf(org: string) {
    return this.#stored.get(org, () => billing.storedBytes(this.#db, org));
  }

  async #within(plan: Plan, limit: Limit, used: () => Promise<bigint>) {
    const allowed = limitOf(plan, limit);
    if (allowed === null) return;
    if ((await used()) < allowed) return;
    const what = LIMIT_NAME[limit](amountOf(limit, allowed));
    throw this.#refusal(
      `The ${PLAN[plan].name} plan includes ${what}, and this organization has reached it. ` +
        `Upgrade to keep going.`,
    );
  }

  #refusal(message: string) {
    return new HttpError(402, `${message} ${this.#upgradeUrl}`, undefined, "payment_required");
  }
}
