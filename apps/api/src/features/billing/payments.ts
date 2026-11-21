import type { PaidPlan } from "./catalog.ts";

export interface Subscription {
  id: string;
  customer: string;
  status: string;
  plan: PaidPlan | null;
  startedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd: boolean;
  endedAt: Date | null;
  nextPlan: PaidPlan | null;
  scheduleDone: boolean;
}

export interface CheckoutAsk {
  org: string;
  customer: string;
  plan: PaidPlan;
  returnUrl: string;
  ui: "hosted" | "custom";
  email?: string;
}

export type CheckoutStart =
  { ui: "hosted"; url: string } | { ui: "custom"; clientSecret: string; publishableKey: string };

export type Notice =
  | { kind: "subscription"; id: string }
  | { kind: "invoice"; id: string; subscription: string | null }
  | { kind: "ignored"; type: string };

export interface Payments {
  createCustomer(org: string, name: string, email?: string): Promise<string>;
  subscription(id: string): Promise<Subscription | null>;
  checkout(ask: CheckoutAsk): Promise<CheckoutStart>;
  portal(customer: string, returnUrl: string): Promise<string>;
  changePlan(subscription: string, plan: PaidPlan, at: "now" | "period_end"): Promise<void>;
  release(subscription: string): Promise<void>;
  cancelAtPeriodEnd(subscription: string, cancel: boolean): Promise<void>;
  cancelNow(subscription: string): Promise<void>;
  notice(payload: string, signature: string): Promise<Notice>;
}
