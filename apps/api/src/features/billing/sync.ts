import type { Db } from "../../db/client.ts";
import { messageOf } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";
import type { Payments, Subscription } from "./payments.ts";
import * as billing from "./queries.ts";
import { type Account, isLive } from "./standing.ts";

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
  }

  async refresh(account: Account) {
    if (account.subscription) await this.subscription(account.subscription);
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
