import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { eq } from "drizzle-orm";

import Stripe from "stripe";

import { loadConfig } from "../src/config.ts";
import { billingUsage, filesystemSizes, namespaces } from "../src/db/schema.ts";
import { METERS, rawCents, unitCents } from "../src/features/billing/catalog.ts";
import type { Notice } from "../src/features/billing/payments.ts";
import * as billing from "../src/features/billing/queries.ts";
import { type Account, standing } from "../src/features/billing/standing.ts";
import { StripePayments } from "../src/features/billing/stripe.ts";
import { summarize } from "../src/features/billing/summary.ts";
import { FakePayments } from "./billing-fake.ts";
import { ADMIN, database, server, skip, unique } from "./helpers.ts";

const KiB = 1024;
const MiB = KiB * KiB;
const GiB = MiB * KiB;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CONSOLE = "https://console.test";
const BILLING = {
  secretKey: "sk_test_fake",
  webhookSecret: "whsec_fake",
  checkout: "hosted" as "hosted" | "custom",
  publishableKey: "pk_test_fake",
  consoleUrl: CONSOLE,
};
const SCHEMA = { vectors: [{ name: "v", dims: 2, metric: "euclidean" }] };
const DOCS = [
  { id: 1, vectors: { v: [0, 0] } },
  { id: 2, vectors: { v: [1, 0] } },
];

const at = (iso: string) => new Date(iso);
const later = (from: Date, ms: number) => new Date(from.getTime() + ms);

async function billed(start = at("2026-11-03T10:15:00Z"), ui: "hosted" | "custom" = "hosted") {
  const clock = { now: start };
  const payments = new FakePayments();
  const s = await server(
    { billing: { ...BILLING, checkout: ui } },
    { payments, now: () => clock.now },
  );
  const { id, key } = await s.org();
  const service = s.services.billing!;
  const hook = async (notice: Notice, signature = "signed") => {
    const response = await s.app.request("/billing/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      body: JSON.stringify(notice),
    });
    return { status: response.status, body: await response.json() };
  };
  const summary = async () => {
    const { status, body } = await s.call("GET", `/orgs/${id}/billing`, key);
    assert.equal(status, 200, JSON.stringify(body));
    return body;
  };
  const checkout = (plan: string, extra: Record<string, unknown> = {}) =>
    s.call("POST", `/orgs/${id}/billing/checkout`, key, { plan, ...extra });
  const subscribe = async (plan: "launch" | "scale" = "launch") => {
    assert.equal((await checkout(plan)).status, 200);
    const customer = [...payments.customers].find(([, org]) => org === id)![0];
    const sub = payments.subscribe(customer, plan, clock.now);
    assert.equal((await hook({ kind: "subscription", id: sub })).status, 200);
    return { customer, sub };
  };
  const use = (meter: string, hour: Date, amount: bigint) =>
    s.db
      .insert(billingUsage)
      .values({ org: id, meter, hour, amount })
      .onConflictDoUpdate({
        target: [billingUsage.org, billingUsage.meter, billingUsage.hour],
        set: { amount },
      });
  const index = (name: string, extra: Record<string, unknown> = {}) =>
    s.call("POST", "/indexes", key, { name, schema: SCHEMA, ...extra });
  return { s, id, key, clock, payments, service, hook, summary, checkout, subscribe, use, index };
}

test("prices in the catalog become exact Stripe unit prices", () => {
  assert.deepEqual(Object.fromEntries(METERS.map((meter) => [meter, unitCents(meter)])), {
    storage: "0.000033443921",
    writes: "0.146484375",
    queries: "0.000071525574",
    embeddings: "0.001",
    reranks: "0.002",
    pinned: "0.00009765625",
    files_storage: "0.000013377568",
    files_egress: "0.0078125",
  });
  assert.equal(rawCents("writes", BigInt(GiB)), 150);
  assert.equal(rawCents("queries", 1n << 50n), 75);
  assert.equal(rawCents("storage", BigInt(GiB) * 730n), 25);
  assert.equal(rawCents("embeddings", 1000n), 1);
  assert.equal(rawCents("reranks", 1000n), 2);
  assert.equal(rawCents("pinned", BigInt(GiB) * 3600n * 1000n), 100);
  assert.equal(rawCents("writes", 2_000_000_000n, "2.00"), 373);
  assert.equal(rawCents("files_storage", BigInt(GiB) * 730n), 10);
  assert.equal(rawCents("files_egress", BigInt(GiB) * 10n), 80);
});

const account = (values: Partial<Account> = {}): Account => ({
  org: "o",
  customer: "cus_1",
  subscription: "sub_1",
  plan: "launch",
  nextPlan: null,
  status: "active",
  startedAt: at("2026-11-01T00:00:00Z"),
  periodStart: at("2026-11-01T00:00:00Z"),
  periodEnd: at("2026-12-01T00:00:00Z"),
  cancelAtPeriodEnd: false,
  endedAt: null,
  pastDueSince: null,
  override: null,
  ...values,
});

test("an organization's plan follows its subscription's status", () => {
  const now = at("2026-11-10T00:00:00Z");
  assert.equal(standing(null, now), "free");
  assert.equal(standing(account(), now), "launch");
  assert.equal(standing(account({ status: "trialing", plan: "scale" }), now), "scale");
  assert.equal(standing(account({ cancelAtPeriodEnd: true }), now), "launch");
  for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
    assert.equal(standing(account({ status }), now), "free", status);
  }
  const late = { status: "past_due", pastDueSince: later(now, -6 * DAY) };
  assert.equal(standing(account(late), now), "launch");
  assert.equal(standing(account({ ...late, pastDueSince: later(now, -7 * DAY) }), now), "free");
  assert.equal(
    standing(account({ status: "canceled", override: "enterprise" }), now),
    "enterprise",
  );
  assert.equal(standing(account({ plan: null }), now), "free");
});

test("the estimate is the usage or the minimum, whichever is more", () => {
  const now = at("2026-11-10T00:00:00Z");
  const measured = (writes: number, values: Partial<Account> = {}) =>
    summarize({
      account: account(values),
      now,
      totals: new Map([["writes", BigInt(writes)]]),
      storedBytes: 0n,
      indexes: 0n,
      filesBytes: 0n,
      filesystems: 0n,
    });
  const small = measured(GiB);
  assert.equal(small.usage_cents, 150);
  assert.equal(small.estimate_cents, 1600);
  assert.equal(small.period_start, "2026-11-01T00:00:00.000Z");
  const big = measured(20 * GiB, { plan: "scale" });
  assert.equal(big.usage_cents, 3000);
  assert.equal(big.estimate_cents, 12_800);
  const free = summarize({
    account: null,
    now,
    totals: new Map(),
    storedBytes: 0n,
    indexes: 2n,
    filesBytes: BigInt(GiB),
    filesystems: 1n,
  });
  assert.equal(free.files.gb, 1);
  assert.equal(free.files.limit_gb, 5);
  assert.equal(free.filesystems.count, 1);
  assert.equal(free.filesystems.limit, 3);
  assert.equal(free.meters.find((line) => line.meter === "files_egress")!.limit, 10);
  assert.equal(free.plan, "free");
  assert.equal(free.estimate_cents, 0);
  assert.equal(free.indexes.limit, 3);
  assert.equal(free.stored.limit_gb, 1);
  assert.equal(free.period_start, "2026-11-01T00:00:00.000Z");
  assert.equal(free.period_end, "2026-12-01T00:00:00.000Z");
  assert.equal(free.meters.find((line) => line.meter === "writes")!.limit, 1);
});

test("billing is off unless a Stripe key is set", () => {
  const base = { SKYWAKE_API_DATABASE: "postgres://x/y", SKYWAKE_STORE: "/tmp/store" };
  assert.equal(loadConfig(base).billing, undefined);
  assert.equal(
    loadConfig({ ...base, STRIPE_SECRET_KEY: "sk_test_1", SKYWAKE_API_BILLING: "off" }).billing,
    undefined,
  );
  const full = {
    ...base,
    STRIPE_SECRET_KEY: "sk_test_1",
    STRIPE_WEBHOOK_SECRET: "whsec_1",
    STRIPE_PUBLISHABLE_KEY: "pk_test_1",
    SKYWAKE_API_CONSOLE_URL: "https://console.example.com/",
  };
  assert.deepEqual(loadConfig(full).billing, {
    secretKey: "sk_test_1",
    webhookSecret: "whsec_1",
    checkout: "hosted",
    publishableKey: "pk_test_1",
    consoleUrl: "https://console.example.com",
  });
  assert.throws(() => loadConfig({ ...full, STRIPE_WEBHOOK_SECRET: "" }), /STRIPE_WEBHOOK_SECRET/);
  assert.equal(loadConfig({ ...full, STRIPE_PUBLISHABLE_KEY: "" }).billing?.publishableKey, null);
  assert.throws(
    () => loadConfig({ ...full, STRIPE_PUBLISHABLE_KEY: "", SKYWAKE_API_CHECKOUT: "custom" }),
    /STRIPE_PUBLISHABLE_KEY/,
  );
  assert.equal(loadConfig({ ...full, SKYWAKE_API_CHECKOUT: "custom" }).billing?.checkout, "custom");
  assert.throws(
    () => loadConfig({ ...full, STRIPE_PUBLISHABLE_KEY: "pk_live_1" }),
    /must be a test key/,
  );
  assert.throws(() =>
    loadConfig({ ...full, SKYWAKE_API_BILLING: "stripe", STRIPE_SECRET_KEY: "" }),
  );
  assert.throws(() => loadConfig({ ...full, STRIPE_SECRET_KEY: "sk_live_1" }), /live key/);
  assert.equal(
    loadConfig({
      ...full,
      STRIPE_SECRET_KEY: "sk_live_1",
      STRIPE_PUBLISHABLE_KEY: "pk_live_1",
      SKYWAKE_API_BILLING_LIVE: "true",
    }).billing?.secretKey,
    "sk_live_1",
  );
  assert.throws(() => loadConfig({ ...full, STRIPE_SECRET_KEY: "pk_test_1" }), /secret/);
  assert.throws(
    () => loadConfig({ ...full, SKYWAKE_API_PRICES: "writes=2" }),
    /SKYWAKE_API_PRICES/,
  );
});

test("a server without Stripe does not bill or limit", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.org();
  const shown = await s.call("GET", `/orgs/${id}/billing`, key);
  assert.equal(shown.status, 200);
  assert.equal(shown.body.enabled, false);
  assert.equal(shown.body.plan, "unlimited");
  const checkout = await s.call("POST", `/orgs/${id}/billing/checkout`, key, { plan: "launch" });
  assert.equal(checkout.status, 501);
  for (const name of ["a", "b", "c", "d"]) {
    assert.equal((await s.call("POST", "/indexes", key, { name, schema: SCHEMA })).status, 201);
  }
  assert.equal((await s.call("GET", "/audit", key)).status, 200);
  const webhook = await s.app.request("/billing/stripe", { method: "POST", body: "{}" });
  assert.equal(webhook.status, 404);
});

test("the Free plan stops at its limits and leaves out paid features", { skip }, async () => {
  const b = await billed();
  const { s, id, key } = b;
  for (const name of ["a", "b", "c"]) assert.equal((await b.index(name)).status, 201);
  const fourth = await b.index("d");
  assert.equal(fourth.status, 402);
  assert.equal(fourth.body.code, "payment_required");
  assert.match(fourth.body.error, /Free plan includes 3 indexes/);
  assert.match(fourth.body.error, /https:\/\/console\.test\/settings#billing/);

  const docs = "/indexes/a/branches/main/documents";
  assert.equal((await s.call("POST", docs, key, { documents: DOCS })).status, 200);
  await b.use("writes", at("2026-11-02T00:00:00Z"), BigInt(GiB));
  b.service.gate.forget(id);
  const refused = await s.call("POST", docs, key, { documents: DOCS });
  assert.equal(refused.status, 402);
  assert.match(refused.body.error, /1 GB of writes a month/);
  const deleted = await s.call("POST", `${docs}/delete`, key, { ids: [1] });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

  const query = "/indexes/a/branches/main/query";
  assert.equal(
    (await s.call("POST", query, key, { vector: { column: "v", value: [0, 0] } })).status,
    200,
  );
  await b.use("queries", at("2026-11-02T00:00:00Z"), 10n << 40n);
  b.service.gate.forget(id);
  const blocked = await s.call("POST", query, key, { vector: { column: "v", value: [0, 0] } });
  assert.equal(blocked.status, 402);
  assert.match(blocked.body.error, /10 TB of queries scanned/);

  b.clock.now = at("2026-12-01T00:30:00Z");
  b.service.gate.forget(id);
  assert.equal(
    (await s.call("POST", query, key, { vector: { column: "v", value: [0, 0] } })).status,
    200,
  );
  assert.equal((await s.call("POST", docs, key, { documents: DOCS })).status, 200);

  const allowlist = `/orgs/${id}/ip-allowlist`;
  const listed = await s.call("PUT", allowlist, key, { cidrs: ["0.0.0.0/0"] });
  assert.equal(listed.status, 402);
  assert.match(listed.body.error, /IP allowlists needs the Scale plan/);
  assert.equal((await s.call("PUT", allowlist, key, { cidrs: [] })).status, 200);
  assert.equal((await s.call("GET", "/audit", key)).status, 402);
  const sso = await s.call("PUT", `/orgs/${id}/sso`, ADMIN, { required_domains: ["acme.test"] });
  assert.equal(sso.status, 402);
  assert.equal(
    (await s.call("PUT", `/orgs/${id}/sso`, ADMIN, { required_domains: [] })).status,
    200,
  );
  await s.call("DELETE", "/indexes/c", key);
  const pinned = await b.index("p", { pinned: { replicas: 1 } });
  assert.equal(pinned.status, 402);
  assert.match(pinned.body.error, /Pinned replicas needs the Launch plan/);
  const keyed = await b.index("k", { encryption: { kms_key_id: "arn:aws:kms:us-east-1:1:key/x" } });
  assert.equal(keyed.status, 402);
  assert.match(keyed.body.error, /Customer-managed keys needs the Scale plan/);

  const shown = await b.summary();
  assert.equal(shown.plan, "free");
  assert.equal(shown.minimum_cents, 0);
  assert.equal(shown.customer, false);
});

test("checkout gives the customer the signed-in person's email", { skip }, async () => {
  const { id, payments, service } = await billed();
  const started = await service.checkout(id, "launch", undefined, "ana@example.com");
  assert.equal(started.ui, "hosted");
  const customer = payments.customerOf(id)!;
  assert.equal(payments.emails.get(customer), "ana@example.com");
  assert.equal(payments.checkouts.at(-1)!.email, "ana@example.com");
});

test("a custom checkout hands the console a session to confirm", { skip }, async () => {
  const b = await billed(undefined, "custom");
  const started = await b.checkout("launch");
  assert.equal(started.status, 200);
  assert.match(started.body.client_secret, /^cs_test_/);
  assert.equal(started.body.publishable_key, "pk_test_fake");
  assert.equal(started.body.url, undefined);
  assert.equal(b.payments.checkouts.at(-1)!.ui, "custom");
});

test("checkout subscribes once, and plans change up at once and down later", { skip }, async () => {
  const b = await billed();
  const { s, id, key, payments } = b;
  const first = await b.checkout("launch");
  const again = await b.checkout("scale");
  assert.equal(first.status, 200);
  assert.match(first.body.url, /^https:\/\/checkout\.test\//);
  assert.equal(first.body.client_secret, undefined);
  assert.equal(payments.checkouts[0]!.email, undefined);
  assert.equal(payments.customers.size, 1);
  assert.equal(payments.checkouts[1]!.plan, "scale");
  assert.equal(payments.checkouts[0]!.returnUrl, `${CONSOLE}/settings#billing`);
  const elsewhere = await b.checkout("launch", { return_url: "https://evil.test/x" });
  assert.equal(elsewhere.status, 400);
  const ok = await b.checkout("launch", { return_url: `${CONSOLE}/settings?x=1` });
  assert.equal(ok.status, 200);
  assert.equal(again.status, 200);

  const { sub } = await b.subscribe("launch");
  let shown = await b.summary();
  assert.equal(shown.plan, "launch");
  assert.equal(shown.status, "active");
  assert.equal(shown.minimum_cents, 1600);
  assert.equal(shown.customer, true);
  assert.equal((await b.checkout("scale")).status, 409);
  for (const name of ["a", "b", "c", "d"]) assert.equal((await b.index(name)).status, 201);
  assert.equal((await s.call("GET", "/audit", key)).status, 402);

  const up = await s.call("PUT", `/orgs/${id}/billing/subscription`, key, { plan: "scale" });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.deepEqual(payments.changes.at(-1), { subscription: sub, plan: "scale", at: "now" });
  assert.equal(up.body.plan, "scale");
  assert.equal((await s.call("GET", "/audit", key)).status, 200);
  const same = await s.call("PUT", `/orgs/${id}/billing/subscription`, key, { plan: "scale" });
  assert.equal(same.status, 409);

  const down = await s.call("PUT", `/orgs/${id}/billing/subscription`, key, { plan: "launch" });
  assert.equal(down.status, 200);
  assert.deepEqual(payments.changes.at(-1), {
    subscription: sub,
    plan: "launch",
    at: "period_end",
  });
  assert.equal(down.body.plan, "scale");
  assert.equal(down.body.next_plan, "launch");
  const kept = await s.call("PUT", `/orgs/${id}/billing/subscription`, key, { plan: "scale" });
  assert.equal(kept.body.next_plan, null);
  assert.equal(kept.body.plan, "scale");

  await s.call("PUT", `/orgs/${id}/billing/subscription`, key, { plan: "launch" });
  payments.renew(sub);
  await b.hook({ kind: "subscription", id: sub });
  shown = await b.summary();
  assert.equal(shown.plan, "launch");
  assert.equal(shown.next_plan, null);
  assert.ok(payments.released.includes(sub));
  assert.equal((await s.call("GET", "/audit", key)).status, 402);

  const portal = await s.call("POST", `/orgs/${id}/billing/portal`, key, {});
  assert.equal(portal.status, 200);
  assert.match(portal.body.url, /^https:\/\/portal\.test\/cus_/);
});

test("an admin ends a subscription at the period's end, or keeps it", { skip }, async () => {
  const b = await billed();
  const path = `/orgs/${b.id}/billing/subscription`;
  assert.equal((await b.s.call("DELETE", path, b.key)).status, 409);
  const { sub } = await b.subscribe("scale");
  await b.s.call("PUT", path, b.key, { plan: "launch" });
  const ending = await b.s.call("DELETE", path, b.key);
  assert.equal(ending.status, 200);
  assert.equal(ending.body.cancel_at_period_end, true);
  assert.equal(ending.body.plan, "scale");
  assert.equal(ending.body.next_plan, null);
  const kept = await b.s.call("POST", `${path}/resume`, b.key);
  assert.equal(kept.body.cancel_at_period_end, false);
  b.payments.update(sub, { status: "canceled", endedAt: b.clock.now });
  await b.hook({ kind: "subscription", id: sub });
  assert.equal((await b.s.call("POST", `${path}/resume`, b.key)).status, 409);
});

test("the portal and plan changes need a subscription", { skip }, async () => {
  const b = await billed();
  const portal = await b.s.call("POST", `/orgs/${b.id}/billing/portal`, b.key, {});
  assert.equal(portal.status, 409);
  const change = await b.s.call("PUT", `/orgs/${b.id}/billing/subscription`, b.key, {
    plan: "scale",
  });
  assert.equal(change.status, 409);
  const other = await b.s.org();
  assert.equal((await b.s.call("GET", `/orgs/${b.id}/billing`, other.key)).status, 404);
});

test("each invoice for a plan credits its minimum against usage once", { skip }, async () => {
  const b = await billed();
  const { customer, sub } = await b.subscribe("launch");
  const { payments } = b;
  const invoice = payments.bill(customer, sub);
  await b.hook({ kind: "invoice", id: invoice, subscription: sub });
  await b.hook({ kind: "invoice", id: invoice, subscription: sub });
  assert.equal(payments.grantsMade.length, 1);
  const grant = payments.grantsMade[0]!;
  assert.equal(grant.cents, 1600);
  assert.equal(grant.invoice, invoice);
  const period = payments.subscriptions.get(sub)!;
  assert.equal(grant.effectiveAt.getTime(), period.periodStart.getTime() + 1000);
  assert.equal(grant.expiresAt.getTime(), period.periodEnd.getTime() + 4 * DAY);

  const draft = payments.bill(customer, sub, { status: "draft" });
  await b.hook({ kind: "invoice", id: draft, subscription: sub });
  assert.equal(payments.grantsMade.length, 1);
  const usageOnly = payments.bill(customer, sub, { planCents: 0, planStart: null, planEnd: null });
  await b.hook({ kind: "invoice", id: usageOnly, subscription: sub });
  assert.equal(payments.grantsMade.length, 1);

  b.clock.now = later(period.periodStart, 10 * DAY);
  const upgrade = payments.bill(customer, sub, {
    planCents: 7467,
    planStart: b.clock.now,
    planEnd: period.periodEnd,
  });
  await b.hook({ kind: "invoice", id: upgrade, subscription: sub });
  const prorated = payments.grantsMade.find((made) => made.invoice === upgrade)!;
  assert.equal(prorated.cents, 7467);
  assert.equal(prorated.effectiveAt.getTime(), b.clock.now.getTime() + 1000);

  payments.invoices.set(invoice, { ...payments.invoices.get(invoice)!, status: "void" });
  await b.hook({ kind: "invoice", id: invoice, subscription: sub });
  assert.equal(grant.voided, true);
  payments.invoices.set(upgrade, { ...payments.invoices.get(upgrade)!, status: "uncollectible" });
  await b.hook({ kind: "invoice", id: upgrade, subscription: sub });
  assert.equal(prorated.voided, true);

  const stranger = payments.bill("cus_unknown", sub);
  await b.hook({ kind: "invoice", id: stranger, subscription: sub });
  assert.equal(payments.grantsMade.length, 2);
});

test("cancellation and failed payments move an organization to Free", { skip }, async () => {
  const b = await billed();
  const { sub } = await b.subscribe("launch");
  const { payments } = b;
  const set = async (values: Parameters<FakePayments["update"]>[1]) => {
    payments.update(sub, values);
    await b.hook({ kind: "subscription", id: sub });
    return b.summary();
  };

  let shown = await set({ cancelAtPeriodEnd: true });
  assert.equal(shown.plan, "launch");
  assert.equal(shown.cancel_at_period_end, true);
  shown = await set({ cancelAtPeriodEnd: false });
  assert.equal(shown.cancel_at_period_end, false);

  shown = await set({ status: "past_due" });
  assert.equal(shown.plan, "launch");
  const since = shown.past_due_since;
  assert.ok(since);
  b.clock.now = later(b.clock.now, 3 * DAY);
  shown = await set({ status: "past_due" });
  assert.equal(shown.past_due_since, since);
  b.clock.now = later(at(since), 7 * DAY);
  b.service.gate.forget(b.id);
  assert.equal((await b.summary()).plan, "free");
  shown = await set({ status: "active" });
  assert.equal(shown.plan, "launch");
  assert.equal(shown.past_due_since, null);

  shown = await set({ status: "canceled", endedAt: b.clock.now });
  assert.equal(shown.plan, "free");
  assert.equal(shown.status, "canceled");
  assert.equal((await b.checkout("launch")).status, 200);
});

test(
  "a second subscription is canceled, and old events never undo newer ones",
  { skip },
  async () => {
    const b = await billed();
    const { customer, sub } = await b.subscribe("launch");
    const { payments } = b;
    const twin = payments.subscribe(customer, "scale", b.clock.now);
    await b.hook({ kind: "subscription", id: twin });
    assert.deepEqual(payments.canceled, [twin]);
    assert.equal((await b.summary()).plan, "launch");

    payments.update(sub, { status: "canceled", endedAt: b.clock.now });
    await b.hook({ kind: "subscription", id: sub });
    b.clock.now = later(b.clock.now, DAY);
    const next = payments.subscribe(customer, "scale", b.clock.now);
    await b.hook({ kind: "subscription", id: next });
    assert.equal((await b.summary()).plan, "scale");
    await b.hook({ kind: "subscription", id: sub });
    await b.hook({ kind: "subscription", id: twin });
    const shown = await b.summary();
    assert.equal(shown.plan, "scale");
    assert.equal(shown.status, "active");

    const unknown = payments.subscribe("cus_other", "launch", b.clock.now);
    assert.equal((await b.hook({ kind: "subscription", id: unknown })).status, 200);
    assert.equal((await b.hook({ kind: "subscription", id: "sub_missing" })).status, 200);
  },
);

test("webhooks need Stripe's signature", { skip }, async () => {
  const b = await billed();
  const bad = await b.hook({ kind: "subscription", id: "x" }, "forged");
  assert.equal(bad.status, 400);
  const bare = await b.s.app.request("/billing/stripe", { method: "POST", body: "{}" });
  assert.equal(bare.status, 400);

  const secret = "whsec_real_test";
  const s = await server(
    { billing: { ...BILLING, webhookSecret: secret } },
    { payments: new StripePayments("sk_test_unused", secret, "pk_test_unused") },
  );
  const payload = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "customer.created",
    data: { object: { id: "cus_1", object: "customer" } },
  });
  const header = new Stripe("sk_test_unused").webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  const send = (body: string, signature: string) =>
    s.app.request("/billing/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body,
    });
  const good = await send(payload, header);
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { received: true, handled: "ignored" });
  assert.equal((await send(payload.replace("cus_1", "cus_2"), header)).status, 400);
});

test(
  "usage reaches Stripe once, an hour at a time, with remainders carried",
  { skip },
  async () => {
    const b = await billed(at("2026-11-03T10:15:00Z"));
    const { customer, sub } = await b.subscribe("launch");
    const { payments, service } = b;
    await b.use("writes", at("2026-11-03T10:00:00Z"), BigInt(5 * MiB));
    await b.use("writes", at("2026-11-03T11:00:00Z"), BigInt(1.5 * MiB));
    await b.use("writes", at("2026-11-03T12:00:00Z"), BigInt(0.75 * MiB));
    await b.use("embeddings", at("2026-11-03T12:00:00Z"), 7n);

    b.clock.now = at("2026-11-03T13:01:00Z");
    await service.reporter.run();
    assert.equal(payments.reports(payments.customerOf(b.id)).length, 1);
    b.clock.now = at("2026-11-03T13:05:00Z");
    await service.reporter.run();
    const writes = payments.reports(payments.customerOf(b.id), "writes");
    assert.deepEqual(
      writes.map((usage) => [usage.at.toISOString(), usage.value, usage.customer]),
      [
        ["2026-11-03T11:00:00.000Z", 1n, customer],
        ["2026-11-03T12:00:00.000Z", 1n, customer],
      ],
    );
    assert.equal(writes[0]!.identifier, `${sub}:writes:2026-11-03T11:00:00.000Z`);
    assert.deepEqual(
      payments.reports(payments.customerOf(b.id), "embeddings").map((usage) => usage.value),
      [7n],
    );
    const cursor = await billing.cursor(b.s.db, b.id, "writes");
    assert.equal(cursor!.remainder, BigInt(MiB / 4));
    assert.equal(cursor!.next.toISOString(), "2026-11-03T13:00:00.000Z");

    await service.reporter.run();
    assert.equal(payments.reports(payments.customerOf(b.id)).length, 3);

    await b.use("writes", at("2026-11-03T13:00:00Z"), BigInt(MiB));
    b.clock.now = at("2026-11-03T14:05:00Z");
    payments.failReports = true;
    await service.reporter.run();
    assert.equal(payments.reports(payments.customerOf(b.id)).length, 3);
    assert.equal(
      (await billing.cursor(b.s.db, b.id, "writes"))!.next.toISOString(),
      "2026-11-03T13:00:00.000Z",
    );
    payments.failReports = false;
    await service.reporter.run();
    assert.equal(payments.reports(payments.customerOf(b.id), "writes").length, 3);
    assert.equal(payments.reports(payments.customerOf(b.id), "writes")[2]!.value, 1n);
  },
);

test(
  "usage of an hour before a renewal goes to the new period once the old invoice is closed",
  { skip },
  async () => {
    const b = await billed(at("2026-11-03T10:15:00Z"));
    const { sub } = await b.subscribe("launch");
    const { payments, service } = b;
    b.clock.now = at("2026-11-03T12:05:00Z");
    await service.reporter.run();
    payments.renew(sub);
    const renewed = payments.subscriptions.get(sub)!.periodStart;
    await b.hook({ kind: "subscription", id: sub });
    const before = new Date(Math.floor((renewed.getTime() - HOUR) / HOUR) * HOUR);
    b.clock.now = later(renewed, 2 * HOUR);
    await billing.moveCursor(b.s.db, {
      org: b.id,
      meter: "reranks",
      subscription: sub,
      next: before,
      remainder: 0n,
    });
    await b.use("reranks", before, 3n);
    await service.reporter.run();
    const [late] = payments.reports(payments.customerOf(b.id), "reranks");
    assert.equal(late!.at.getTime(), renewed.getTime());
  },
);

test("a canceled subscription reports its last hours, then stops", { skip }, async () => {
  const b = await billed(at("2026-11-03T10:15:00Z"));
  const { sub } = await b.subscribe("launch");
  const { payments, service } = b;
  const ended = at("2026-11-03T12:30:00Z");
  payments.update(sub, { status: "canceled", endedAt: ended });
  await b.hook({ kind: "subscription", id: sub });
  await b.use("reranks", at("2026-11-03T12:00:00Z"), 4n);
  await b.use("reranks", at("2026-11-03T13:00:00Z"), 9n);
  b.clock.now = at("2026-11-03T14:30:00Z");
  await service.reporter.run();
  assert.deepEqual(
    payments.reports(payments.customerOf(b.id), "reranks").map((usage) => usage.value),
    [4n],
  );
  b.clock.now = at("2026-11-03T16:00:00Z");
  await b.use("reranks", at("2026-11-03T12:00:00Z"), 40n);
  await billing.moveCursor(b.s.db, {
    org: b.id,
    meter: "reranks",
    subscription: sub,
    next: at("2026-11-03T12:00:00Z"),
    remainder: 0n,
  });
  await service.reporter.run();
  assert.equal(payments.reports(payments.customerOf(b.id), "reranks").length, 1);
});

test(
  "a new subscription starts counting afresh, and Free usage is never sent",
  { skip },
  async () => {
    const b = await billed(at("2026-11-03T10:15:00Z"));
    const { payments, service } = b;
    await b.use("writes", at("2026-11-03T09:00:00Z"), BigInt(50 * MiB));
    b.clock.now = at("2026-11-03T10:20:00Z");
    await service.reporter.run();
    assert.equal(payments.reports(payments.customerOf(b.id)).length, 0);

    const { customer, sub } = await b.subscribe("launch");
    b.clock.now = at("2026-11-03T12:10:00Z");
    await b.use("writes", at("2026-11-03T11:00:00Z"), BigInt(2 * MiB));
    await service.reporter.run();
    assert.deepEqual(
      payments.reports(payments.customerOf(b.id), "writes").map((usage) => usage.value),
      [2n],
    );

    payments.update(sub, { status: "canceled", endedAt: at("2026-11-03T12:10:00Z") });
    await b.hook({ kind: "subscription", id: sub });
    b.clock.now = at("2026-11-04T09:10:00Z");
    const next = payments.subscribe(customer, "scale", b.clock.now);
    await b.hook({ kind: "subscription", id: next });
    await b.use("writes", at("2026-11-04T08:00:00Z"), BigInt(3 * MiB));
    await b.use("writes", at("2026-11-04T10:00:00Z"), BigInt(3 * MiB));
    b.clock.now = at("2026-11-04T11:05:00Z");
    await service.reporter.run();
    const fresh = payments
      .reports(payments.customerOf(b.id), "writes")
      .filter((usage) => usage.identifier.startsWith(next));
    assert.deepEqual(
      fresh.map((usage) => [usage.at.toISOString(), usage.value]),
      [["2026-11-04T10:00:00.000Z", 3n]],
    );
  },
);

test("writes and queries are measured in bytes", { skip }, async () => {
  const b = await billed();
  const { s, key, id, service } = b;
  assert.equal((await b.index("m")).status, 201);
  const body = { documents: DOCS };
  assert.equal((await s.call("POST", "/indexes/m/branches/main/documents", key, body)).status, 200);
  await service.ledger.flush();
  const now = b.clock.now;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let totals = await billing.usageSince(s.db, id, from);
  assert.ok((totals.get("writes") ?? 0n) >= BigInt(Buffer.byteLength(JSON.stringify(DOCS))) / 2n);

  await service.sampler.run();
  const sized = (await billing.usageSince(s.db, id, from)).get("storage");
  assert.ok(sized && sized > 0n);
  await service.sampler.run();
  assert.equal((await billing.usageSince(s.db, id, from)).get("storage"), sized);
  await s.services.usage.flush();

  const query = { vector: { column: "v", value: [0, 0] } };
  assert.equal((await s.call("POST", "/indexes/m/branches/main/query", key, query)).status, 200);
  assert.equal((await s.call("POST", "/indexes/m/branches/main/query", key, query)).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await service.ledger.flush();
  totals = await billing.usageSince(s.db, id, from);
  assert.equal(totals.get("queries"), 2n * sized!);
});

test("only one server runs billing at a time", { skip }, async () => {
  const db = await database();
  const name = `billing-test-${unique()}`;
  assert.equal(await billing.tryLease(db, name, "a", 60_000), true);
  assert.equal(await billing.tryLease(db, name, "b", 60_000), false);
  assert.equal(await billing.tryLease(db, name, "a", 60_000), true);
  await billing.dropLease(db, name, "a");
  assert.equal(await billing.tryLease(db, name, "b", 60_000), true);
  await billing.dropLease(db, name, "b");
});

test("the operator puts an organization on Enterprise", { skip }, async () => {
  const b = await billed();
  const path = `/orgs/${b.id}/billing/plan`;
  assert.equal((await b.s.call("PUT", path, b.key, { plan: "enterprise" })).status, 401);
  const set = await b.s.call("PUT", path, ADMIN, { plan: "enterprise" });
  assert.equal(set.status, 200);
  assert.equal(set.body.plan, "enterprise");
  assert.equal((await b.s.call("GET", "/audit", b.key)).status, 200);
  assert.equal((await b.checkout("launch")).status, 409);
  const back = await b.s.call("PUT", path, ADMIN, { plan: "default" });
  assert.equal(back.body.plan, "free");
  assert.equal(
    (await b.s.call("PUT", `/orgs/nope/billing/plan`, ADMIN, { plan: "enterprise" })).status,
    404,
  );
});

const filesystem = async (b: Awaited<ReturnType<typeof billed>>, name: string) => {
  const { s, key } = b;
  const made = await s.call("POST", "/namespaces", b.key, { name });
  if (made.status !== 201) return made;
  const ref = `/namespaces/${encodeURIComponent(name)}`;
  assert.equal((await s.call("POST", `${ref}/branches`, key, { name: "main" })).status, 201);
  return made;
};
const commitTo = (b: Awaited<ReturnType<typeof billed>>, name: string, ...changes: unknown[]) =>
  b.s.call("POST", `/namespaces/${encodeURIComponent(name)}/branches/main/commits`, b.key, {
    message: "change",
    changes,
  });
const download = async (b: Awaited<ReturnType<typeof billed>>, name: string, path: string) => {
  const response = await b.s.app.request(
    `/v1/namespaces/${encodeURIComponent(name)}/branches/main/files/content?path=${path}`,
    { headers: { authorization: `Bearer ${b.key}` } },
  );
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
};
const randomText = (bytes: number) => randomBytes(bytes / 2).toString("hex");

test(
  "filesystems are sized, re-sized after a change, and billed as files storage",
  { skip },
  async () => {
    const b = await billed();
    const { s, id, service } = b;
    assert.equal((await filesystem(b, "docs")).status, 201);
    assert.equal(
      (await commitTo(b, "docs", { path: "a.txt", text: randomText(64 * KiB) })).status,
      201,
    );
    const from = at("2026-11-01T00:00:00Z");

    await service.sampler.run();
    const [first] = await s.db.select().from(filesystemSizes).where(eq(filesystemSizes.org, id));
    assert.ok(first && first.bytes > 0n && first.objects > 0);
    assert.equal(first.stale, false);
    assert.equal((await billing.usageSince(s.db, id, from)).get("files_storage"), first.bytes);

    b.clock.now = later(b.clock.now, HOUR);
    await service.sampler.run();
    const [kept] = await s.db.select().from(filesystemSizes).where(eq(filesystemSizes.org, id));
    assert.equal(kept!.measured.getTime(), first.measured.getTime());
    assert.equal((await billing.usageSince(s.db, id, from)).get("files_storage"), 2n * first.bytes);

    assert.equal(
      (await commitTo(b, "docs", { path: "b.txt", text: randomText(64 * KiB) })).status,
      201,
    );
    const [stale] = await s.db.select().from(filesystemSizes).where(eq(filesystemSizes.org, id));
    assert.equal(stale!.stale, true);
    b.clock.now = later(b.clock.now, HOUR);
    await service.sampler.run();
    const [grown] = await s.db.select().from(filesystemSizes).where(eq(filesystemSizes.org, id));
    assert.ok(grown!.bytes > first.bytes);
    assert.equal(grown!.stale, false);

    b.clock.now = later(b.clock.now, DAY);
    await service.sampler.run();
    const [daily] = await s.db.select().from(filesystemSizes).where(eq(filesystemSizes.org, id));
    assert.ok(daily!.measured.getTime() > grown!.measured.getTime());
    assert.equal(daily!.bytes, grown!.bytes);

    service.gate.forget(id);
    const summary = await b.summary();
    assert.equal(summary.filesystems.count, 1);
    assert.equal(summary.filesystems.limit, 3);
    assert.ok(summary.files.gb > 0);
    assert.equal(summary.files.limit_gb, 5);
  },
);

test("downloads are metered by the bytes sent", { skip }, async () => {
  const b = await billed();
  const { s, id, service } = b;
  await filesystem(b, "docs");
  const text = randomText(10 * KiB);
  await commitTo(b, "docs", { path: "a.txt", text });
  const read = await download(b, "docs", "a.txt");
  assert.equal(read.status, 200);
  assert.equal(read.bytes.toString(), text);
  await download(b, "docs", "a.txt");
  await service.ledger.flush();
  const totals = await billing.usageSince(s.db, id, at("2026-11-01T00:00:00Z"));
  assert.equal(totals.get("files_egress"), 2n * BigInt(text.length));
});

test("the Free plan stops at its files limits, and a paid plan lifts them", { skip }, async () => {
  const b = await billed();
  const { s, id, service } = b;
  for (const name of ["a", "b", "c"]) assert.equal((await filesystem(b, name)).status, 201);
  const fourth = await filesystem(b, "d");
  assert.equal(fourth.status, 402);
  assert.equal(fourth.body.code, "payment_required");
  assert.match(fourth.body.error, /Free plan includes 3 filesystems/);

  assert.equal((await commitTo(b, "a", { path: "a.txt", text: "hello" })).status, 201);
  assert.equal((await commitTo(b, "b", { path: "a.txt", text: "hello" })).status, 201);
  const [row] = await s.db.select().from(namespaces).where(eq(namespaces.org, id)).limit(1);
  await billing.saveSize(s.db, {
    folder: row!.folder,
    org: id,
    bytes: 5n * BigInt(GiB),
    objects: 1,
    measured: b.clock.now,
  });
  service.gate.forget(id);
  const full = await commitTo(b, "a", { path: "b.txt", text: "more" });
  assert.equal(full.status, 402);
  assert.match(full.body.error, /5 GB of files/);
  const upload = await s.app.request("/v1/namespaces/a/uploads", {
    method: "POST",
    headers: { authorization: `Bearer ${b.key}`, "content-type": "application/octet-stream" },
    body: new Uint8Array(Buffer.from("part")),
  });
  assert.equal(upload.status, 402);
  const removed = await commitTo(b, "a", { path: "a.txt", delete: true });
  assert.equal(removed.status, 201, JSON.stringify(removed.body));
  assert.equal((await commitTo(b, "a", { path: "c.txt", text: "x" })).status, 402);

  assert.equal((await download(b, "b", "a.txt")).status, 200);
  await b.use("files_egress", at("2026-11-02T00:00:00Z"), 10n * BigInt(GiB));
  service.gate.forget(id);
  const blocked = await download(b, "b", "a.txt");
  assert.equal(blocked.status, 402);
  assert.match(blocked.bytes.toString(), /10 GB of file downloads a month/);

  await b.subscribe("launch");
  service.gate.forget(id);
  assert.equal((await filesystem(b, "d")).status, 201);
  assert.equal((await commitTo(b, "a", { path: "c.txt", text: "x" })).status, 201);
  assert.equal((await download(b, "b", "a.txt")).status, 200);
});

test("a subscription made before a meter existed gets the new meter", { skip }, async () => {
  const b = await billed();
  const { sub } = await b.subscribe("launch");
  assert.deepEqual(b.payments.metersAdded, []);
  b.payments.update(sub, { missingMeters: ["files_storage", "files_egress"] });
  assert.equal((await b.hook({ kind: "subscription", id: sub })).status, 200);
  assert.deepEqual(b.payments.metersAdded, [
    { subscription: sub, meters: ["files_storage", "files_egress"] },
  ]);
  assert.equal((await b.hook({ kind: "subscription", id: sub })).status, 200);
  assert.equal(b.payments.metersAdded.length, 1);
});

test(
  "a filesystem in another region keeps its last size and is not measured here",
  { skip },
  async () => {
    const b = await billed();
    const { s, id, service } = b;
    await filesystem(b, "docs");
    await commitTo(b, "docs", { path: "a.txt", text: randomText(16 * KiB) });
    await service.sampler.run();
    const [first] = await s.db.select().from(filesystemSizes).where(eq(filesystemSizes.org, id));
    await s.db.update(namespaces).set({ region: "elsewhere" }).where(eq(namespaces.org, id));

    b.clock.now = later(b.clock.now, 2 * DAY);
    await service.sampler.run();
    const [kept] = await s.db.select().from(filesystemSizes).where(eq(filesystemSizes.org, id));
    assert.equal(kept!.measured.getTime(), first!.measured.getTime());
    const usage = await billing.usageSince(s.db, id, at("2026-11-01T00:00:00Z"));
    assert.equal(usage.get("files_storage"), 2n * first!.bytes);
    assert.ok(!s.logs.some((line) => line.msg === "filesystem not sized for billing"));
  },
);
