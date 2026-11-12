import type { billing as contract } from "@skywake/contract";

import { limitOf, METER, METERS, type Meter, PLAN, PLANS, rawCents, shown } from "./catalog.ts";
import { type Account, isLive, standing } from "./standing.ts";

const GiB = 2 ** 30;

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
  const charged = plan !== "free";
  const meters = METERS.map((meter) => {
    const raw = totals.get(meter) ?? 0n;
    const spec = METER[meter];
    const limit = limitOf(plan, meter);
    return {
      meter,
      name: spec.name,
      quantity: shown(meter, raw),
      unit: spec.shownAs,
      price: `$${spec.dollars} per ${spec.per}`,
      amount_cents: charged ? rawCents(meter, raw) : 0,
      limit: limit === null ? null : shown(meter, limit),
    };
  });
  const usage = meters.reduce((sum, line) => sum + line.amount_cents, 0);
  const minimum = PLAN[plan].minimumCents;
  const storedLimit = limitOf(plan, "stored");
  const indexLimit = limitOf(plan, "indexes");
  const filesLimit = limitOf(plan, "files_stored");
  const filesystemLimit = limitOf(plan, "filesystems");
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
    minimum_cents: minimum,
    usage_cents: usage,
    estimate_cents: Math.max(usage, minimum ?? 0),
    meters,
    stored: {
      gb: Number(storedBytes) / GiB,
      limit_gb: storedLimit === null ? null : Number(storedLimit) / GiB,
    },
    indexes: {
      count: Number(indexes),
      limit: indexLimit === null ? null : Number(indexLimit),
    },
    files: {
      gb: Number(filesBytes) / GiB,
      limit_gb: filesLimit === null ? null : Number(filesLimit) / GiB,
    },
    filesystems: {
      count: Number(filesystems),
      limit: filesystemLimit === null ? null : Number(filesystemLimit),
    },
    features: [...PLAN[plan].features],
    plans: offers(),
    customer: account?.customer != null,
  };
}

export const offers = () =>
  PLANS.map((name) => ({
    plan: name,
    name: PLAN[name].name,
    minimum_cents: PLAN[name].minimumCents,
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
    stored: { gb: Number(storedBytes) / GiB, limit_gb: null },
    indexes: { count: Number(indexes), limit: null },
    files: { gb: Number(filesBytes) / GiB, limit_gb: null },
    filesystems: { count: Number(filesystems), limit: null },
    features: ["pinning", "sso", "audit_log", "ip_allowlist", "customer_keys"],
    plans: [],
    customer: false,
  };
}
