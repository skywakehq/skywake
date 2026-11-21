import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

import Stripe from "stripe";

import { PAID, PLAN, planKey } from "../src/features/billing/catalog.ts";
import { StripePayments } from "../src/features/billing/stripe.ts";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  throw new Error("this check runs only with a test-mode STRIPE_SECRET_KEY");
}

const stripe = new Stripe(key);
const payments = new StripePayments(key, "whsec_unused", "pk_test_unused", stripe);
const step = (text: string) => console.log(`- ${text}`);

async function advance(clock: string, to: number) {
  await stripe.testHelpers.testClocks.advance(clock, { frozen_time: to });
  for (;;) {
    const found = await stripe.testHelpers.testClocks.retrieve(clock);
    if (found.status === "ready") return;
    if (found.status === "internal_failure") throw new Error("test clock failed");
    await sleep(2000);
  }
}

const prices = await stripe.prices.list({
  lookup_keys: PAID.map(planKey),
  active: true,
  limit: 100,
});
const price = (lookup: string) => prices.data.find((p) => p.lookup_key === lookup)!.id;

const start = Math.floor(Date.now() / 1000);
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: start,
  name: "skywake e2e",
});
try {
  const customer = await stripe.customers.create({
    name: "Skywake e2e",
    test_clock: clock.id,
    metadata: { org: "org_e2e" },
  });
  const method = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: method.id },
  });

  step("a checkout session and the portal open with the catalog's prices");
  const started = await payments.checkout({
    org: "org_e2e",
    customer: customer.id,
    plan: "launch",
    returnUrl: "https://console.example.com/settings/billing",
    ui: "custom",
  });
  assert.ok(started.ui === "custom");
  assert.match(started.clientSecret, /^cs_test_.+_secret_/);
  const hosted = await payments.checkout({
    org: "org_e2e",
    customer: customer.id,
    plan: "launch",
    returnUrl: "https://console.example.com/settings/billing",
    ui: "hosted",
  });
  assert.ok(hosted.ui === "hosted");
  assert.match(hosted.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.match(
    await payments.portal(customer.id, "https://console.example.com/settings"),
    /^https:\/\/billing\.stripe\.com\//,
  );

  step("a Launch subscription starts and its first invoice is paid");
  const created = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: price(planKey("launch")), quantity: 1 }],
    metadata: { org: "org_e2e" },
  });
  const sub = (await payments.subscription(created.id))!;
  assert.equal(sub.plan, "launch");
  assert.equal(sub.status, "active");
  assert.equal(sub.nextPlan, null);
  const first = await stripe.invoices.retrieve(idOf(created.latest_invoice));
  assert.equal(first.status, "paid");
  assert.equal(first.total, PLAN.launch.priceCents);

  step("renewal bills the plan's price and nothing else");
  await advance(clock.id, Math.floor(sub.periodEnd.getTime() / 1000) + 2 * 3600);
  const invoices = await stripe.invoices.list({ subscription: created.id, limit: 10 });
  const cycle = invoices.data.find((i) => i.billing_reason === "subscription_cycle");
  assert.ok(cycle, "a renewal invoice exists");
  assert.equal(cycle.total, PLAN.launch.priceCents);
  const renewed = (await payments.subscription(created.id))!;
  assert.ok(renewed.periodStart.getTime() >= sub.periodEnd.getTime());

  step("an upgrade charges the prorated difference at once");
  await payments.changePlan(created.id, "scale", "now");
  const upgraded = (await payments.subscription(created.id))!;
  assert.equal(upgraded.plan, "scale");
  const upgrade = (await stripe.invoices.list({ subscription: created.id, limit: 10 })).data.find(
    (i) => i.billing_reason === "subscription_update",
  );
  assert.ok(upgrade);
  console.log(`  prorated difference ${upgrade.total} cents`);
  assert.ok(upgrade.total > 0 && upgrade.total <= PLAN.scale.priceCents! - PLAN.launch.priceCents!);

  step("a downgrade waits for the period's end, and can be taken back");
  await payments.changePlan(created.id, "launch", "period_end");
  assert.equal((await payments.subscription(created.id))!.nextPlan, "launch");
  assert.equal((await payments.subscription(created.id))!.plan, "scale");
  await payments.changePlan(created.id, "scale", "period_end");
  assert.equal((await payments.subscription(created.id))!.nextPlan, null);
  await payments.changePlan(created.id, "launch", "period_end");
  await advance(clock.id, Math.floor(upgraded.periodEnd.getTime() / 1000) + 2 * 3600);
  const moved = (await payments.subscription(created.id))!;
  assert.equal(moved.plan, "launch");
  assert.equal(moved.nextPlan, null);

  step("cancel at the period's end keeps the plan until then");
  assert.equal(moved.scheduleDone, true);
  await payments.release(created.id);
  assert.equal((await payments.subscription(created.id))!.scheduleDone, false);
  await payments.cancelAtPeriodEnd(created.id, true);
  const ending = (await payments.subscription(created.id))!;
  assert.equal(ending.cancelAtPeriodEnd, true);
  assert.equal(ending.status, "active");
  await advance(clock.id, Math.floor(ending.periodEnd.getTime() / 1000) + 2 * 3600);
  const ended = (await payments.subscription(created.id))!;
  assert.equal(ended.status, "canceled");
  assert.ok(ended.endedAt);
  console.log("All checks passed");
} finally {
  await stripe.testHelpers.testClocks.del(clock.id);
}

function idOf(ref: string | { id?: string } | null | undefined) {
  return typeof ref === "string" ? ref : (ref?.id ?? "");
}
