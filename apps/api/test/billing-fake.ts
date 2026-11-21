import { randomUUID } from "node:crypto";

import type { PaidPlan } from "../src/features/billing/catalog.ts";
import type {
  CheckoutAsk,
  CheckoutStart,
  Notice,
  Payments,
  Subscription,
} from "../src/features/billing/payments.ts";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export class SignatureError extends Error {
  override name = "StripeSignatureVerificationError";
}

export class FakePayments implements Payments {
  readonly customers = new Map<string, string>();
  readonly subscriptions = new Map<string, Subscription>();
  readonly checkouts: CheckoutAsk[] = [];
  readonly emails = new Map<string, string>();
  readonly canceled: string[] = [];
  readonly changes: { subscription: string; plan: PaidPlan; at: string }[] = [];
  #ids = 0;

  #id(prefix: string) {
    return `${prefix}_${randomUUID().slice(0, 8)}${++this.#ids}`;
  }

  async createCustomer(org: string, _name: string, email?: string) {
    for (const [id, owner] of this.customers) if (owner === org) return id;
    const id = this.#id("cus");
    this.customers.set(id, org);
    if (email) this.emails.set(id, email);
    return id;
  }

  subscribe(customer: string, plan: PaidPlan, start: Date, status = "active") {
    const id = this.#id("sub");
    this.subscriptions.set(id, {
      id,
      customer,
      status,
      plan,
      startedAt: start,
      periodStart: start,
      periodEnd: new Date(start.getTime() + MONTH_MS),
      cancelAtPeriodEnd: false,
      endedAt: null,
      nextPlan: null,
      scheduleDone: false,
    });
    return id;
  }

  update(id: string, values: Partial<Subscription>) {
    const found = this.subscriptions.get(id)!;
    this.subscriptions.set(id, { ...found, ...values });
  }

  renew(id: string) {
    const found = this.subscriptions.get(id)!;
    this.update(id, {
      periodStart: found.periodEnd,
      periodEnd: new Date(found.periodEnd.getTime() + MONTH_MS),
      plan: found.nextPlan ?? found.plan,
      nextPlan: null,
      scheduleDone: found.nextPlan !== null,
    });
  }

  async subscription(id: string) {
    return this.subscriptions.get(id) ?? null;
  }

  async checkout(ask: CheckoutAsk): Promise<CheckoutStart> {
    this.checkouts.push(ask);
    if (ask.ui === "hosted")
      return { ui: "hosted", url: `https://checkout.test/${ask.customer}/${ask.plan}` };
    return {
      ui: "custom",
      clientSecret: `cs_test_${ask.customer}_${ask.plan}_secret`,
      publishableKey: "pk_test_fake",
    };
  }

  async portal(customer: string, returnUrl: string) {
    return `https://portal.test/${customer}?return=${encodeURIComponent(returnUrl)}`;
  }

  async changePlan(subscription: string, plan: PaidPlan, at: "now" | "period_end") {
    this.changes.push({ subscription, plan, at });
    const found = this.subscriptions.get(subscription)!;
    if (found.plan === plan) this.update(subscription, { nextPlan: null });
    else if (at === "now") this.update(subscription, { plan, nextPlan: null });
    else this.update(subscription, { nextPlan: plan });
  }

  readonly released: string[] = [];

  async release(subscription: string) {
    this.released.push(subscription);
    this.update(subscription, { scheduleDone: false });
  }

  async cancelAtPeriodEnd(subscription: string, cancel: boolean) {
    this.update(subscription, { cancelAtPeriodEnd: cancel, nextPlan: null });
  }

  async cancelNow(subscription: string) {
    this.canceled.push(subscription);
    this.update(subscription, { status: "canceled", endedAt: new Date() });
  }

  async notice(payload: string, signature: string): Promise<Notice> {
    if (signature !== "signed") throw new SignatureError("No signatures found");
    return JSON.parse(payload) as Notice;
  }

  customerOf(org: string) {
    return [...this.customers].find(([, owner]) => owner === org)?.[0] ?? "";
  }
}
