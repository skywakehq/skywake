import { PAST_DUE_GRACE_DAYS, type PaidPlan, type Plan } from "./catalog.ts";

export type Status =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export interface Account {
  org: string;
  customer: string | null;
  subscription: string | null;
  plan: PaidPlan | null;
  nextPlan: PaidPlan | null;
  status: string | null;
  startedAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  endedAt: Date | null;
  pastDueSince: Date | null;
  override: "enterprise" | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const LIVE: ReadonlySet<string> = new Set<Status>(["active", "trialing", "past_due"]);

export const isLive = (status: string | null) => status !== null && LIVE.has(status);

export function standing(account: Account | null, now: Date): Plan {
  if (!account) return "free";
  if (account.override) return account.override;
  if (!account.plan || !isLive(account.status)) return "free";
  if (account.status === "past_due") {
    const since = account.pastDueSince ?? now;
    if (now.getTime() - since.getTime() >= PAST_DUE_GRACE_DAYS * DAY_MS) return "free";
  }
  return account.plan;
}

export function billed(account: Account | null): account is Account & {
  customer: string;
  subscription: string;
  startedAt: Date;
} {
  return (
    account !== null &&
    account.customer !== null &&
    account.subscription !== null &&
    account.startedAt !== null
  );
}
