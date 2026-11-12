import type { Db } from "../../db/client.ts";
import { messageOf } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";
import { METER, METERS, type Meter } from "./catalog.ts";
import { hourOf } from "./ledger.ts";
import type { Payments } from "./payments.ts";
import * as billing from "./queries.ts";
import { type Account, billed, isLive } from "./standing.ts";
import type { Sync } from "./sync.ts";

const HOUR_MS = 60 * 60 * 1000;
const SETTLE_MS = 2 * 60 * 1000;
const DRAFT_OPEN_MS = 45 * 60 * 1000;
const AFTER_END_MS = 3 * HOUR_MS;
const OLDEST_MS = 34 * 24 * HOUR_MS;

const ceilHour = (at: Date) => new Date(Math.ceil(at.getTime() / HOUR_MS) * HOUR_MS);
const later = (at: Date, ms: number) => new Date(at.getTime() + ms);

export class Reporter {
  readonly #db: Db;
  readonly #payments: Payments;
  readonly #sync: Sync;
  readonly #log: Log;
  readonly #now: () => Date;

  constructor(
    db: Db,
    payments: Payments,
    sync: Sync,
    log: Log,
    now: () => Date = () => new Date(),
  ) {
    this.#db = db;
    this.#payments = payments;
    this.#sync = sync;
    this.#log = log;
    this.#now = now;
  }

  async run() {
    for (const listed of await billing.subscribed(this.#db)) {
      try {
        await this.#account(listed);
      } catch (error) {
        this.#log({
          level: "error",
          msg: "usage not reported",
          org: listed.org,
          error: messageOf(error),
        });
      }
    }
  }

  async #account(listed: Account) {
    let account = listed;
    const now = this.#now();
    if (isLive(account.status) && account.periodEnd && account.periodEnd <= now) {
      await this.#sync.refresh(account);
      account = (await billing.account(this.#db, account.org)) ?? account;
    }
    if (!billed(account)) return;
    const ended = account.status === "canceled" ? account.endedAt : null;
    if (!isLive(account.status) && !ended) return;
    if (ended && now.getTime() - ended.getTime() > AFTER_END_MS) return;
    for (const meter of METERS) await this.#meter(account, meter, ended);
  }

  async #meter(
    account: Account & { customer: string; subscription: string; startedAt: Date },
    meter: Meter,
    ended: Date | null,
  ) {
    const now = this.#now();
    const saved = await billing.cursor(this.#db, account.org, meter);
    const fresh = !saved || saved.subscription !== account.subscription;
    let next = fresh ? ceilHour(account.startedAt) : saved.next;
    let remainder = fresh ? 0n : saved.remainder;
    const oldest = hourOf(later(now, -OLDEST_MS));
    if (next < oldest) {
      this.#log({ level: "error", msg: "usage too old to report", org: account.org, meter });
      next = oldest;
    }
    let until = hourOf(later(now, -SETTLE_MS));
    if (ended && ceilHour(ended) < until) until = ceilHour(ended);

    const cursor = { org: account.org, meter, subscription: account.subscription };
    if (next >= until) {
      if (fresh) await billing.moveCursor(this.#db, { ...cursor, next, remainder });
      return;
    }
    const amounts = await billing.hourly(this.#db, account.org, meter, next, until);
    const unit = METER[meter].unitRaw;
    for (let hour = next; hour < until; hour = later(hour, HOUR_MS)) {
      const raw = (amounts.get(hour.getTime()) ?? 0n) + remainder;
      const units = raw / unit;
      remainder = raw % unit;
      if (units > 0n) {
        await this.#payments.report({
          meter,
          customer: account.customer,
          value: units,
          at: this.#stamp(hour, account, now),
          identifier: `${account.subscription}:${meter}:${hour.toISOString()}`,
        });
        await billing.moveCursor(this.#db, { ...cursor, next: later(hour, HOUR_MS), remainder });
      }
    }
    await billing.moveCursor(this.#db, { ...cursor, next: until, remainder });
  }

  #stamp(hour: Date, account: Account, now: Date) {
    const start = account.periodStart;
    if (start && hour < start && now >= later(start, DRAFT_OPEN_MS)) return start;
    return hour;
  }
}
