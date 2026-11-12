import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, signedIn } from "./http.ts";
import { z } from "./schemas.ts";

const OrgParam = z.object({
  org: z.string().openapi({ param: { name: "org", in: "path" }, example: "org_123" }),
});

export const Plan = z.enum(["free", "launch", "scale", "enterprise", "unlimited"]).openapi("Plan", {
  description: "`unlimited` when the server does not bill, as when self-hosted.",
});
export type Plan = z.infer<typeof Plan>;

export const PaidPlan = z.enum(["launch", "scale"]).openapi("PaidPlan");
export type PaidPlan = z.infer<typeof PaidPlan>;

export const Feature = z
  .enum(["pinning", "sso", "audit_log", "ip_allowlist", "customer_keys"])
  .openapi("PlanFeature");
export type Feature = z.infer<typeof Feature>;

export const Meter = z
  .enum([
    "storage",
    "writes",
    "queries",
    "embeddings",
    "reranks",
    "pinned",
    "files_storage",
    "files_egress",
  ])
  .openapi("Meter");
export type Meter = z.infer<typeof Meter>;

const cents = (description: string) => z.number().int().openapi({ description });
const at = z.string().nullable().openapi({ description: "An ISO 8601 time." });

export const MeterUsage = z
  .object({
    meter: Meter,
    name: z.string(),
    quantity: z.number(),
    unit: z.string().openapi({ example: "GB written" }),
    price: z.string().openapi({ example: "$1.50 per GB written" }),
    amount_cents: cents("What the quantity costs, before the minimum."),
    limit: z
      .number()
      .nullable()
      .openapi({ description: "The plan's monthly limit, if it has one." }),
  })
  .openapi("MeterUsage");

export const PlanOffer = z
  .object({
    plan: Plan,
    name: z.string(),
    minimum_cents: z.number().int().nullable(),
    features: z.array(Feature),
  })
  .openapi("PlanOffer");

export const Billing = z
  .object({
    enabled: z.boolean().openapi({ description: "Whether this server bills at all." }),
    plan: Plan,
    name: z.string(),
    status: z.string().nullable().openapi({ description: "The subscription's status in Stripe." }),
    period_start: at,
    period_end: at,
    next_plan: PaidPlan.nullable().openapi({
      description: "The plan the subscription moves to when the period ends.",
    }),
    cancel_at_period_end: z.boolean(),
    past_due_since: at,
    minimum_cents: z.number().int().nullable(),
    usage_cents: cents("The usage of the period so far."),
    estimate_cents: cents("The usage or the minimum, whichever is more."),
    meters: z.array(MeterUsage),
    stored: z.object({ gb: z.number(), limit_gb: z.number().nullable() }),
    indexes: z.object({ count: z.number().int(), limit: z.number().int().nullable() }),
    files: z
      .object({ gb: z.number(), limit_gb: z.number().nullable() })
      .openapi({ description: "Bytes stored by the organization's filesystems." }),
    filesystems: z.object({ count: z.number().int(), limit: z.number().int().nullable() }),
    features: z.array(Feature),
    plans: z.array(PlanOffer),
    customer: z.boolean().openapi({ description: "Whether the portal can be opened." }),
  })
  .openapi("Billing");
export type Billing = z.infer<typeof Billing>;

export const Redirect = z.object({ url: z.string() }).openapi("Redirect");

export const CheckoutSession = z
  .object({
    client_secret: z.string().openapi({ description: "Opens the session with Stripe.js." }),
    publishable_key: z.string().openapi({ description: "The Stripe key Stripe.js loads with." }),
  })
  .openapi("CheckoutSession");

export const CheckoutStart = z.union([Redirect, CheckoutSession]).openapi("CheckoutStart", {
  description:
    "A Stripe Checkout page to send the person to, or, with SKYWAKE_API_CHECKOUT=custom, a session the console confirms itself.",
});

export const getBilling = createRoute({
  method: "get",
  path: "/orgs/{org}/billing",
  operationId: "getBilling",
  tags: ["billing"],
  summary: "The organization's plan and its usage this period.",
  security: signedIn,
  request: { params: OrgParam },
  responses: { 200: json(Billing, "The plan and usage."), ...errors(401, 403, 404) },
});

export const startCheckout = createRoute({
  method: "post",
  path: "/orgs/{org}/billing/checkout",
  operationId: "startCheckout",
  tags: ["billing"],
  summary: "Starts a Stripe Checkout that subscribes the organization to a plan.",
  security: signedIn,
  request: {
    params: OrgParam,
    body: body(z.object({ plan: PaidPlan, return_url: z.url().optional() }).openapi("NewCheckout")),
  },
  responses: {
    200: json(CheckoutStart, "Where to pay."),
    ...errors(400, 401, 403, 404, 409, 501),
  },
});

export const openPortal = createRoute({
  method: "post",
  path: "/orgs/{org}/billing/portal",
  operationId: "openPortal",
  tags: ["billing"],
  summary: "A Stripe customer portal page, to change the card or plan, or cancel.",
  security: signedIn,
  request: {
    params: OrgParam,
    body: body(z.object({ return_url: z.url().optional() }).openapi("NewPortal")),
  },
  responses: {
    200: json(Redirect, "Where to send the person."),
    ...errors(400, 401, 403, 404, 409, 501),
  },
});

export const changePlan = createRoute({
  method: "put",
  path: "/orgs/{org}/billing/subscription",
  operationId: "changePlan",
  tags: ["billing"],
  summary:
    "Moves the subscription to another plan: at once for a larger plan, charging the difference " +
    "for the rest of the period; at the period's end for a smaller one.",
  security: signedIn,
  request: { params: OrgParam, body: body(z.object({ plan: PaidPlan }).openapi("PlanChange")) },
  responses: { 200: json(Billing, "The plan and usage."), ...errors(400, 401, 403, 404, 409, 501) },
});

export const cancelSubscription = createRoute({
  method: "delete",
  path: "/orgs/{org}/billing/subscription",
  operationId: "cancelSubscription",
  tags: ["billing"],
  summary: "Ends the subscription when the period ends; the organization then moves to Free.",
  security: signedIn,
  request: { params: OrgParam },
  responses: { 200: json(Billing, "The plan and usage."), ...errors(401, 403, 404, 409, 501) },
});

export const resumeSubscription = createRoute({
  method: "post",
  path: "/orgs/{org}/billing/subscription/resume",
  operationId: "resumeSubscription",
  tags: ["billing"],
  summary: "Keeps a subscription that was set to end.",
  security: signedIn,
  request: { params: OrgParam },
  responses: { 200: json(Billing, "The plan and usage."), ...errors(401, 403, 404, 409, 501) },
});

export const setPlan = createRoute({
  method: "put",
  path: "/orgs/{org}/billing/plan",
  operationId: "setPlan",
  tags: ["billing"],
  summary: "Puts the organization on Enterprise, or takes it off. Needs the server's admin token.",
  security: signedIn,
  request: {
    params: OrgParam,
    body: body(z.object({ plan: z.enum(["enterprise", "default"]) }).openapi("PlanOverride")),
  },
  responses: { 200: json(Billing, "The plan and usage."), ...errors(400, 401, 404, 501) },
});
