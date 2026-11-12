import Stripe from "stripe";

import {
  type Meter,
  METERS,
  meterEvent,
  meterKey,
  PAID,
  type PaidPlan,
  planKey,
} from "./catalog.ts";
import type {
  CheckoutAsk,
  CheckoutStart,
  Grant,
  Invoice,
  InvoiceStatus,
  NewGrant,
  Notice,
  Payments,
  Subscription,
  Usage,
} from "./payments.ts";

export const PORTAL_TAG = "skywake_portal";
const INVOICE_TAG = "skywake_invoice";

const date = (seconds: number) => new Date(seconds * 1000);
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);
const idOf = (ref: string | { id: string } | null | undefined) =>
  ref == null ? null : typeof ref === "string" ? ref : ref.id;

interface Catalog {
  plans: Map<string, PaidPlan>;
  planOf: Record<PaidPlan, string>;
  meters: string[];
  meterOf: Record<Meter, string>;
}

const CLOCK_SLACK_MS = 60_000;

export class StripePayments implements Payments {
  readonly #stripe: Stripe;
  readonly #webhookSecret: string;
  readonly #publishableKey: string | null;
  #catalog: Promise<Catalog> | null = null;
  #portal: Promise<string> | null = null;

  constructor(
    secretKey: string,
    webhookSecret: string,
    publishableKey: string | null,
    stripe?: Stripe,
  ) {
    this.#stripe =
      stripe ?? new Stripe(secretKey, { maxNetworkRetries: 3, appInfo: { name: "skywake" } });
    this.#webhookSecret = webhookSecret;
    this.#publishableKey = publishableKey;
  }

  async createCustomer(org: string, name: string, email?: string) {
    const customer = await this.#stripe.customers.create(
      { name, ...(email ? { email } : {}), metadata: { org } },
      { idempotencyKey: `customer-${org}` },
    );
    return customer.id;
  }

  async subscription(id: string): Promise<Subscription | null> {
    const found = await this.#stripe.subscriptions
      .retrieve(id, { expand: ["schedule"] })
      .catch(missing);
    if (!found) return null;
    const { plans, meterOf } = await this.#loadCatalog();
    const schedule = typeof found.schedule === "object" ? found.schedule : null;
    const upcoming = schedule?.phases.find(
      (phase) => phase.start_date > (schedule.current_phase?.start_date ?? 0),
    );
    const nextPrice = upcoming?.items
      .map((item) => idOf(item.price))
      .find((price) => price !== null && plans.has(price));
    const items = found.items.data;
    const planItem = items.find((item) => plans.has(item.price.id));
    const timed = planItem ?? items[0];
    return {
      id: found.id,
      customer: idOf(found.customer)!,
      status: found.status,
      plan: planItem ? plans.get(planItem.price.id)! : null,
      startedAt: date(found.start_date),
      periodStart: date(timed?.current_period_start ?? found.start_date),
      periodEnd: date(timed?.current_period_end ?? found.start_date),
      cancelAtPeriodEnd: found.cancel_at_period_end || found.cancel_at !== null,
      endedAt: found.ended_at === null ? null : date(found.ended_at),
      nextPlan: nextPrice ? plans.get(nextPrice)! : null,
      scheduleDone: schedule !== null && upcoming === undefined,
      missingMeters: METERS.filter(
        (meter) => !items.some((item) => item.price.id === meterOf[meter]),
      ),
    };
  }

  async invoice(id: string): Promise<Invoice | null> {
    const found = await this.#stripe.invoices.retrieve(id).catch(missing);
    if (!found?.id) return null;
    const { plans } = await this.#loadCatalog();
    let cents = 0;
    let start: number | null = null;
    let end: number | null = null;
    for await (const line of this.#stripe.invoices.listLineItems(found.id, { limit: 100 })) {
      const price = idOf(line.pricing?.price_details?.price);
      if (!price || !plans.has(price)) continue;
      cents += line.amount;
      start = start === null ? line.period.start : Math.min(start, line.period.start);
      end = end === null ? line.period.end : Math.max(end, line.period.end);
    }
    return {
      id: found.id,
      customer: idOf(found.customer)!,
      subscription: idOf(found.parent?.subscription_details?.subscription),
      status: (found.status ?? "draft") as InvoiceStatus,
      planCents: cents,
      planStart: start === null ? null : date(start),
      planEnd: end === null ? null : date(end),
    };
  }

  async grants(customer: string): Promise<Grant[]> {
    const found: Grant[] = [];
    for await (const grant of this.#stripe.billing.creditGrants.list({ customer, limit: 100 })) {
      found.push({
        id: grant.id,
        invoice: grant.metadata[INVOICE_TAG] ?? null,
        voided: grant.voided_at !== null,
      });
    }
    return found;
  }

  async grant(grant: NewGrant) {
    const later = grant.effectiveAt.getTime() > Date.now() + CLOCK_SLACK_MS;
    const from = later ? seconds(grant.effectiveAt) : undefined;
    await this.#stripe.billing.creditGrants.create(
      {
        customer: grant.customer,
        name: "Monthly minimum",
        category: "paid",
        amount: { type: "monetary", monetary: { value: grant.cents, currency: "usd" } },
        applicability_config: { scope: { price_type: "metered" } },
        ...(from ? { effective_at: from } : {}),
        expires_at: seconds(grant.expiresAt),
        metadata: { [INVOICE_TAG]: grant.invoice },
      },
      { idempotencyKey: `grant-${grant.invoice}-${from ?? "now"}` },
    );
  }

  async voidGrant(id: string) {
    await this.#stripe.billing.creditGrants.voidGrant(id);
  }

  async report(usage: Usage) {
    try {
      await this.#stripe.billing.meterEvents.create({
        event_name: meterEvent(usage.meter),
        identifier: usage.identifier,
        timestamp: seconds(usage.at),
        payload: { stripe_customer_id: usage.customer, value: usage.value.toString() },
      });
    } catch (error) {
      if (!alreadyReported(error)) throw error;
    }
  }

  async checkout(ask: CheckoutAsk): Promise<CheckoutStart> {
    const publishableKey = this.#publishableKey;
    if (ask.ui === "custom" && !publishableKey) {
      throw new Error("a custom checkout needs a publishable key");
    }
    for await (const open of this.#stripe.checkout.sessions.list({
      customer: ask.customer,
      status: "open",
      limit: 100,
    })) {
      await this.#expire(open.id);
    }
    if (ask.email) await this.#addEmail(ask.customer, ask.email);
    const { planOf, meters } = await this.#loadCatalog();
    const common = {
      mode: "subscription",
      customer: ask.customer,
      client_reference_id: ask.org,
      line_items: [{ price: planOf[ask.plan], quantity: 1 }, ...meters.map((price) => ({ price }))],
      subscription_data: { metadata: { org: ask.org } },
    } satisfies Stripe.Checkout.SessionCreateParams;
    const done = withQuery(ask.returnUrl, "checkout", "done");
    if (ask.ui === "custom") {
      const session = await this.#stripe.checkout.sessions.create({
        ...common,
        ui_mode: "elements",
        return_url: done,
      });
      return {
        ui: "custom",
        clientSecret: session.client_secret!,
        publishableKey: publishableKey!,
      };
    }
    const session = await this.#stripe.checkout.sessions.create({
      ...common,
      success_url: done,
      cancel_url: withQuery(ask.returnUrl, "checkout", "canceled"),
    });
    return { ui: "hosted", url: session.url! };
  }

  async #expire(id: string) {
    try {
      await this.#stripe.checkout.sessions.expire(id);
    } catch (error) {
      const session = await this.#stripe.checkout.sessions.retrieve(id);
      if (session.status === "open") throw error;
    }
  }

  async #addEmail(id: string, email: string) {
    const customer = await this.#stripe.customers.retrieve(id);
    if (customer.deleted || customer.email) return;
    await this.#stripe.customers.update(id, { email });
  }

  async portal(customer: string, returnUrl: string) {
    const configuration = await this.#loadPortal();
    const session = await this.#stripe.billingPortal.sessions.create({
      customer,
      configuration,
      return_url: returnUrl,
    });
    return session.url;
  }

  async changePlan(id: string, plan: PaidPlan, at: "now" | "period_end") {
    const { planOf, plans } = await this.#loadCatalog();
    await this.release(id);
    const found = await this.#stripe.subscriptions.retrieve(id);
    const planItem = found.items.data.find((item) => plans.has(item.price.id));
    if (!planItem) throw new Error(`subscription ${id} has no plan`);
    const target = planOf[plan];
    if (planItem.price.id === target) return;
    if (at === "now") {
      await this.#stripe.subscriptions.update(id, {
        items: [{ id: planItem.id, price: target }],
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
      });
      return;
    }
    const made = await this.#stripe.subscriptionSchedules.create({ from_subscription: id });
    const current = made.phases[0]!;
    const itemsWith = (price: (item: Stripe.SubscriptionItem) => string) =>
      found.items.data.map((item) =>
        item.price.recurring?.usage_type === "metered"
          ? { price: price(item) }
          : { price: price(item), quantity: item.quantity ?? 1 },
      );
    await this.#stripe.subscriptionSchedules.update(made.id, {
      end_behavior: "release",
      phases: [
        {
          items: itemsWith((item) => item.price.id),
          start_date: current.start_date,
          end_date: current.end_date,
        },
        {
          items: itemsWith((item) => (item.id === planItem.id ? target : item.price.id)),
          duration: { interval: "month", interval_count: 1 },
        },
      ],
    });
  }

  async addMeters(subscription: string, meters: Meter[]) {
    const { meterOf } = await this.#loadCatalog();
    for (const meter of meters) {
      await this.#stripe.subscriptionItems.create(
        { subscription, price: meterOf[meter], proration_behavior: "none" },
        { idempotencyKey: `meter-${subscription}-${meter}` },
      );
    }
  }

  async release(id: string) {
    const found = await this.#stripe.subscriptions.retrieve(id);
    const schedule = idOf(found.schedule);
    if (schedule) await this.#stripe.subscriptionSchedules.release(schedule);
  }

  async cancelAtPeriodEnd(id: string, cancel: boolean) {
    await this.release(id);
    await this.#stripe.subscriptions.update(id, { cancel_at_period_end: cancel });
  }

  async cancelNow(subscription: string) {
    await this.#stripe.subscriptions.cancel(subscription, { invoice_now: true, prorate: true });
  }

  async notice(payload: string, signature: string): Promise<Notice> {
    const event = await this.#stripe.webhooks.constructEventAsync(
      payload,
      signature,
      this.#webhookSecret,
    );
    const object = event.data.object as { id?: string; object?: string; subscription?: unknown };
    if (event.type.startsWith("customer.subscription.") && object.id) {
      return { kind: "subscription", id: object.id };
    }
    if (event.type === "checkout.session.completed") {
      const subscription = idOf(object.subscription as string | null);
      if (subscription) return { kind: "subscription", id: subscription };
    }
    if (event.type.startsWith("invoice.") && object.id) {
      const invoice = object as Stripe.Invoice;
      return {
        kind: "invoice",
        id: object.id,
        subscription: idOf(invoice.parent?.subscription_details?.subscription),
      };
    }
    return { kind: "ignored", type: event.type };
  }

  #loadCatalog() {
    this.#catalog ??= this.#fetchCatalog().catch((error: unknown) => {
      this.#catalog = null;
      throw error;
    });
    return this.#catalog;
  }

  async #fetchCatalog(): Promise<Catalog> {
    const keys = [...PAID.map(planKey), ...METERS.map(meterKey)];
    const prices = await this.#stripe.prices.list({ lookup_keys: keys, active: true, limit: 100 });
    const byKey = new Map(prices.data.map((price) => [price.lookup_key, price.id]));
    const missingKeys = keys.filter((key) => !byKey.has(key));
    if (missingKeys.length > 0) {
      throw new Error(`Stripe has no active price for ${missingKeys.join(", ")}`);
    }
    const planOf = Object.fromEntries(
      PAID.map((plan) => [plan, byKey.get(planKey(plan))!]),
    ) as Record<PaidPlan, string>;
    return {
      plans: new Map(PAID.map((plan) => [planOf[plan], plan])),
      planOf,
      meters: METERS.map((meter) => byKey.get(meterKey(meter))!),
      meterOf: Object.fromEntries(
        METERS.map((meter) => [meter, byKey.get(meterKey(meter))!]),
      ) as Record<Meter, string>,
    };
  }

  #loadPortal() {
    this.#portal ??= this.#fetchPortal().catch((error: unknown) => {
      this.#portal = null;
      throw error;
    });
    return this.#portal;
  }

  async #fetchPortal() {
    for await (const configuration of this.#stripe.billingPortal.configurations.list({
      active: true,
      limit: 100,
    })) {
      if (configuration.metadata?.[PORTAL_TAG]) return configuration.id;
    }
    throw new Error("Stripe has no customer portal configuration tagged for Skywake");
  }
}

function missing(error: unknown): null {
  if (error instanceof Stripe.errors.StripeError && error.statusCode === 404) return null;
  throw error;
}

function alreadyReported(error: unknown) {
  return (
    error instanceof Stripe.errors.StripeError &&
    error.statusCode === 400 &&
    /identifier/i.test(error.message) &&
    /already|exists|duplicate/i.test(error.message)
  );
}

function withQuery(url: string, key: string, value: string) {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}
