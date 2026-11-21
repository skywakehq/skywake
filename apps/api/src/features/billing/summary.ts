import type { billing as contract } from "@skywake/contract";

import { limitOf, type Meter, PLAN, PLANS } from "./catalog.ts";
import { type Account, isLive, standing } from "./standing.ts";

const GiB = 2 ** 30;

const gbOf = (bytes: bigint | null) => (bytes === null ? null : Number(bytes) / GiB);
const iso = (at: Date | null) => at?.toISOString() ?? null;
const month = (now: Date, offset: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));

export function periodOf(account: Account | null, now: Date) {
  if (account && isLive(account.status) && account.periodStart && account.periodEnd) {
    return { start: account.periodStart, end: account.periodEnd };
  }
  return { start: month(now, 0), end: month(now, 1) };
}

export interface Measured {
  account: Account | null;
  now: Date;
  totals: Map<Meter, bigint>;
  storedBytes: bigint;
  indexes: bigint;
  filesBytes: bigint;
  filesystems: bigint;
}

export function summarize({
  account,
  now,
  totals,
  storedBytes,
  indexes,
  filesBytes,
  filesystems,
}: Measured): contract.Billing {
  const plan = standing(account, now);
  const live = account !== null && isLive(account.status);
  const period = periodOf(account, now);
  const price = PLAN[plan].priceCents;
  const storedLimit = limitOf(plan, "stored");
  return {
    enabled: true,
    plan,
    name: PLAN[plan].name,
    status: account?.status ?? null,
    period_start: iso(period.start),
    period_end: iso(period.end),
    next_plan: live ? (account.nextPlan ?? null) : null,
    cancel_at_period_end: account?.cancelAtPeriodEnd ?? false,
    past_due_since: iso(account?.pastDueSince ?? null),
    minimum_cents: price,
    usage_cents: 0,
    estimate_cents: price ?? 0,
    meters: [],
    stored: { gb: Number(storedBytes + filesBytes) / GiB, limit_gb: gbOf(storedLimit) },
    indexes: { count: Number(indexes), limit: null },
    files: { gb: Number(filesBytes) / GiB, limit_gb: null },
    filesystems: { count: Number(filesystems), limit: null },
    features: [...PLAN[plan].features],
    plans: offers(),
    customer: account?.customer != null,
  };
}

export const offers = () =>
  PLANS.map((name) => ({
    plan: name,
    name: PLAN[name].name,
    minimum_cents: PLAN[name].priceCents,
    storage_gb: gbOf(limitOf(name, "stored")),
    features: [...PLAN[name].features],
  }));

export function unbilled(
  storedBytes: bigint,
  indexes: bigint,
  filesBytes: bigint,
  filesystems: bigint,
): contract.Billing {
  return {
    enabled: false,
    plan: "unlimited",
    name: "Unlimited",
    status: null,
    period_start: null,
    period_end: null,
    next_plan: null,
    cancel_at_period_end: false,
    past_due_since: null,
    minimum_cents: null,
    usage_cents: 0,
    estimate_cents: 0,
    meters: [],
    stored: { gb: Number(storedBytes + filesBytes) / GiB, limit_gb: null },
    indexes: { count: Number(indexes), limit: null },
    files: { gb: Number(filesBytes) / GiB, limit_gb: null },
    filesystems: { count: Number(filesystems), limit: null },
    features: ["pinning", "sso", "audit_log", "ip_allowlist", "customer_keys"],
    plans: [],
    customer: false,
  };
}
