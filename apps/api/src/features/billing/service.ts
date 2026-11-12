import { randomUUID } from "node:crypto";

import type { billing as contract } from "@skywake/contract";

import type { Db } from "../../db/client.ts";
import type { Stores } from "../../engine/stores.ts";
import { badRequest, conflict, messageOf } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";
import { type Feature, type Meter, type PaidPlan, PLAN } from "./catalog.ts";
import { Gate } from "./gate.ts";
import { Ledger } from "./ledger.ts";
import type { Payments } from "./payments.ts";
import * as billing from "./queries.ts";
import { Reporter } from "./reporter.ts";
import { Sampler, type Sized } from "./sampler.ts";
import { isLive } from "./standing.ts";
import { periodOf, summarize } from "./summary.ts";
import { Sync } from "./sync.ts";

const TICK_MS = 5 * 60 * 1000;
const LEASE_MS = 15 * 60 * 1000;
const REFRESH_MS = 60 * 60 * 1000;
const LEASE = "billing";

export interface BillingDeps {
  db: Db;
  payments: Payments;
  stores: Stores;
  sized: Sized;
  log: Log;
  consoleUrl: string;
  checkout?: "hosted" | "custom";
  now?: () => Date;
}

export class Billing {
  readonly gate: Gate;
  readonly ledger: Ledger;
  readonly sync: Sync;
  readonly reporter: Reporter;
  readonly sampler: Sampler;
  readonly #db: Db;
  readonly #payments: Payments;
  readonly #log: Log;
  readonly #consoleUrl: string;
  readonly #ui: "hosted" | "custom";
  readonly #now: () => Date;
  readonly #holder = randomUUID();
  #timer: NodeJS.Timeout | null = null;
  #ticking: Promise<void> | null = null;
  #refreshed = 0;

  constructor(deps: BillingDeps) {
    const now = deps.now ?? (() => new Date());
    this.#db = deps.db;
    this.#payments = deps.payments;
    this.#log = deps.log;
    this.#consoleUrl = deps.consoleUrl;
    this.#ui = deps.checkout ?? "hosted";
    this.#now = now;
    this.ledger = new Ledger(deps.db, deps.log, now);
    this.gate = new Gate(deps.db, this.ledger, this.upgradeUrl, now);
    this.sync = new Sync(deps.db, deps.payments, deps.log, (org) => this.gate.forget(org), now);
    this.reporter = new Reporter(deps.db, deps.payments, this.sync, deps.log, now);
    this.sampler = new Sampler(deps.db, deps.stores, deps.sized, deps.log, now);
  }

  get upgradeUrl() {
    return `${this.#consoleUrl}/settings#billing`;
  }

  record(org: string, meter: Meter, amount: bigint) {
    this.ledger.add(org, meter, amount);
  }

  admit(org: string, meter: Meter) {
    return this.gate.admit(org, meter);
  }

  require(org: string, feature: Feature) {
    return this.gate.require(org, feature);
  }

  admitIndex(org: string) {
    return this.gate.admitIndex(org);
  }

  admitFilesystem(org: string) {
    return this.gate.admitFilesystem(org);
  }

  admitFiles(org: string) {
    return this.gate.admitFiles(org);
  }

  changed(folder: string) {
    return billing.markStale(this.#db, folder);
  }

  start() {
    this.#timer = setInterval(() => void this.tick(), TICK_MS);
    this.#timer.unref();
    void this.tick();
  }

  async stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#ticking;
    await this.ledger.flush();
    await billing.dropLease(this.#db, LEASE, this.#holder).catch(() => {});
  }

  tick() {
    this.#ticking ??= this.#tick().finally(() => (this.#ticking = null));
    return this.#ticking;
  }

  async #tick() {
    try {
      if (!(await billing.tryLease(this.#db, LEASE, this.#holder, LEASE_MS))) return;
      await this.ledger.flush();
      await this.sampler.run();
      if (performance.now() - this.#refreshed > REFRESH_MS || this.#refreshed === 0) {
        for (const account of await billing.subscribed(this.#db)) {
          await this.sync.refresh(account).catch((error: unknown) =>
            this.#log({
              level: "warn",
              msg: "subscription not refreshed",
              org: account.org,
              error: messageOf(error),
            }),
          );
        }
        this.#refreshed = performance.now();
      }
      await this.reporter.run();
    } catch (error) {
      this.#log({ level: "error", msg: "billing run failed", error: messageOf(error) });
    }
  }

  async notice(payload: string, signature: string) {
    const notice = await this.#payments.notice(payload, signature);
    if (notice.kind === "subscription") await this.sync.subscription(notice.id);
    if (notice.kind === "invoice") {
      await this.sync.invoice(notice.id);
      if (notice.subscription) await this.sync.subscription(notice.subscription);
    }
    return notice;
  }

  async checkout(org: string, plan: PaidPlan, returnUrl: string | undefined, email?: string) {
    const account = await billing.account(this.#db, org);
    if (account?.override) throw conflict("this organization's plan is set by Skywake");
    if (account && isLive(account.status)) {
      throw conflict("this organization already has a subscription; change it in the portal");
    }
    const customer = account?.customer ?? (await this.#customer(org, email));
    return this.#payments.checkout({
      org,
      customer,
      plan,
      returnUrl: this.#returnUrl(returnUrl),
      ui: this.#ui,
      ...(email ? { email } : {}),
    });
  }

  async changePlan(org: string, plan: PaidPlan) {
    const account = await billing.account(this.#db, org);
    if (!account?.subscription || !account.plan || !isLive(account.status)) {
      throw conflict("this organization has no subscription; start one with checkout");
    }
    if (account.plan === plan && !account.nextPlan) {
      throw conflict(`this organization is already on ${PLAN[plan].name}`);
    }
    const larger = (PLAN[plan].minimumCents ?? 0) > (PLAN[account.plan].minimumCents ?? 0);
    await this.#payments.changePlan(account.subscription, plan, larger ? "now" : "period_end");
    await this.sync.subscription(account.subscription);
    return this.summary(org);
  }

  async cancel(org: string, cancel: boolean) {
    const account = await billing.account(this.#db, org);
    if (!account?.subscription || !isLive(account.status)) {
      throw conflict("this organization has no subscription");
    }
    await this.#payments.cancelAtPeriodEnd(account.subscription, cancel);
    await this.sync.subscription(account.subscription);
    return this.summary(org);
  }

  async portal(org: string, returnUrl: string | undefined) {
    const account = await billing.account(this.#db, org);
    if (!account?.customer) throw conflict("this organization has no billing account yet");
    return this.#payments.portal(account.customer, this.#returnUrl(returnUrl));
  }

  async override(org: string, plan: "enterprise" | null) {
    await billing.change(this.#db, org, { override: plan });
    this.gate.forget(org);
  }

  async summary(org: string): Promise<contract.Billing> {
    await this.ledger.flush();
    const now = this.#now();
    const account = await billing.account(this.#db, org);
    const from = periodOf(account, now).start;
    return summarize({
      account,
      now,
      totals: await billing.usageSince(this.#db, org, from),
      storedBytes: await billing.storedBytes(this.#db, org),
      indexes: await billing.indexCount(this.#db, org),
      filesBytes: await billing.filesStored(this.#db, org),
      filesystems: await billing.filesystemCount(this.#db, org),
    });
  }

  async #customer(org: string, email?: string) {
    const name = (await billing.orgName(this.#db, org)) ?? org;
    const created = await this.#payments.createCustomer(org, name, email);
    return billing.claimCustomer(this.#db, org, created);
  }

  #returnUrl(asked: string | undefined) {
    if (!asked) return this.upgradeUrl;
    const allowed = new URL(this.#consoleUrl).origin;
    if (new URL(asked).origin !== allowed) throw badRequest(`return_url must be on ${allowed}`);
    return asked;
  }
}
