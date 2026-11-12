import type { Db } from "../../db/client.ts";
import { messageOf } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";
import type { Payments, Subscription } from "./payments.ts";
import * as billing from "./queries.ts";
import { type Account, isLive } from "./standing.ts";

const GRANT_AFTER_PERIOD_MS = 4 * 24 * 60 * 60 * 1000;

export class Sync {
  readonly #db: Db;
  readonly #payments: Payments;
  readonly #log: Log;
  readonly #now: () => Date;
  readonly #changed: (org: string) => void;

  constructor(
    db: Db,
    payments: Payments,
    log: Log,
    changed: (org: string) => void,
    now: () => Date = () => new Date(),
  ) {
    this.#db = db;
    this.#payments = payments;
    this.#log = log;
    this.#changed = changed;
    this.#now = now;
  }

  async subscription(id: string) {
    const found = await this.#payments.subscription(id);
    if (!found) return;
    const account = await billing.accountByCustomer(this.#db, found.customer);
    if (!account) {
      this.#log({ level: "warn", msg: "subscription of an unknown customer", subscription: id });
      return;
    }
    if (account.subscription && account.subscription !== found.id) {
      if (!(await this.#replaces(account, found))) return;
    }
    await this.#save(account, found);
    if (found.scheduleDone) await this.#payments.release(found.id);
    if (isLive(found.status) && found.missingMeters.length > 0) {
      await this.#addMeters(account, found);
    }
  }

  async #addMeters(account: Account, found: Subscription) {
    try {
      await this.#payments.addMeters(found.id, found.missingMeters);
      this.#log({
        level: "info",
        msg: "meters added to subscription",
        org: account.org,
        meters: found.missingMeters.join(","),
      });
    } catch (error) {
      this.#log({
        level: "error",
        msg: "meters not added to subscription",
        org: account.org,
        error: messageOf(error),
      });
    }
  }

  async refresh(account: Account) {
    if (account.subscription) await this.subscription(account.subscription);
  }

  async invoice(id: string) {
    const invoice = await this.#payments.invoice(id);
    if (!invoice) return;
    const account = await billing.accountByCustomer(this.#db, invoice.customer);
    if (!account) return;
    const grants = (await this.#payments.grants(invoice.customer)).filter(
      (grant) => grant.invoice === invoice.id && !grant.voided,
    );
    const owed = invoice.status === "open" || invoice.status === "paid";
    if (owed && invoice.planCents > 0 && grants.length === 0 && invoice.planEnd) {
      const now = this.#now();
      const start = invoice.planStart ?? now;
      await this.#payments.grant({
        customer: invoice.customer,
        invoice: invoice.id,
        cents: invoice.planCents,
        effectiveAt: new Date(Math.max(now.getTime(), start.getTime() + 1000)),
        expiresAt: new Date(invoice.planEnd.getTime() + GRANT_AFTER_PERIOD_MS),
      });
      this.#log({ level: "info", msg: "minimum credited", org: account.org, invoice: invoice.id });
    }
    if (invoice.status === "void" || invoice.status === "uncollectible") {
      for (const grant of grants) await this.#payments.voidGrant(grant.id);
    }
  }

  async #replaces(account: Account, found: Subscription) {
    const current = await this.#payments.subscription(account.subscription!);
    if (!current || !isLive(current.status)) {
      return isLive(found.status) || found.startedAt > (current?.startedAt ?? new Date(0));
    }
    if (isLive(found.status)) {
      await this.#payments.cancelNow(found.id);
      this.#log({
        level: "error",
        msg: "second subscription canceled",
        org: account.org,
        kept: current.id,
        canceled: found.id,
      });
    }
    return false;
  }

  async #save(account: Account, found: Subscription) {
    const pastDue = found.status === "past_due";
    const since = account.subscription === found.id ? account.pastDueSince : null;
    await billing.change(this.#db, account.org, {
      subscription: found.id,
      plan: found.plan,
      nextPlan: found.nextPlan,
      status: found.status,
      startedAt: found.startedAt,
      periodStart: found.periodStart,
      periodEnd: found.periodEnd,
      cancelAtPeriodEnd: found.cancelAtPeriodEnd,
      endedAt: found.endedAt,
      pastDueSince: pastDue ? (since ?? this.#now()) : null,
    });
    this.#changed(account.org);
  }
}
