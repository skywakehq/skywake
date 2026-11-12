import { billing as routes } from "@skywake/contract";
import type { Context } from "hono";

import { note } from "../../audit/note.ts";
import { allowOrgAdmin } from "../../auth/roles.ts";
import type { AppEnv, Ctx, Feature, Services } from "../../http/context.ts";
import { errorBody, HttpError, messageOf, notFound } from "../../http/errors.ts";
import { operator, signedIn } from "../../http/request.ts";
import * as orgs from "../orgs/queries.ts";
import * as billing from "./queries.ts";
import type { Billing } from "./service.ts";
import { unbilled } from "./summary.ts";

export const WEBHOOK_PATH = "/billing/stripe";

async function orgAdmin(c: Ctx, org: string) {
  const caller = await signedIn(c);
  allowOrgAdmin(caller);
  if (caller.org !== org) throw notFound(`organization \`${org}\``);
  return caller;
}

function billingOf(c: Ctx): Billing {
  const found = c.var.services.billing;
  if (!found) throw new HttpError(501, "this server does not bill", undefined, "not_implemented");
  return found;
}

async function summaryOf(c: Ctx, org: string) {
  const found = c.var.services.billing;
  if (found) return found.summary(org);
  const { db } = c.var.services;
  return unbilled(
    await billing.storedBytes(db, org),
    await billing.indexCount(db, org),
    await billing.filesStored(db, org),
    await billing.filesystemCount(db, org),
  );
}

export const billingFeature: Feature = {
  register(api) {
    api.openapi(routes.getBilling, async (c) => {
      const { org } = c.req.valid("param");
      await orgAdmin(c, org);
      return c.json(await summaryOf(c, org), 200);
    });

    api.openapi(routes.startCheckout, async (c) => {
      const { org } = c.req.valid("param");
      const caller = await orgAdmin(c, org);
      const { plan, return_url } = c.req.valid("json");
      const started = await billingOf(c).checkout(org, plan, return_url, caller.email);
      note(c, { details: { plan } });
      return c.json(
        started.ui === "hosted"
          ? { url: started.url }
          : { client_secret: started.clientSecret, publishable_key: started.publishableKey },
        200,
      );
    });

    api.openapi(routes.changePlan, async (c) => {
      const { org } = c.req.valid("param");
      await orgAdmin(c, org);
      const { plan } = c.req.valid("json");
      const summary = await billingOf(c).changePlan(org, plan);
      note(c, { details: { plan } });
      return c.json(summary, 200);
    });

    api.openapi(routes.cancelSubscription, async (c) => {
      const { org } = c.req.valid("param");
      await orgAdmin(c, org);
      const summary = await billingOf(c).cancel(org, true);
      note(c, {});
      return c.json(summary, 200);
    });

    api.openapi(routes.resumeSubscription, async (c) => {
      const { org } = c.req.valid("param");
      await orgAdmin(c, org);
      const summary = await billingOf(c).cancel(org, false);
      note(c, {});
      return c.json(summary, 200);
    });

    api.openapi(routes.openPortal, async (c) => {
      const { org } = c.req.valid("param");
      await orgAdmin(c, org);
      const url = await billingOf(c).portal(org, c.req.valid("json").return_url);
      return c.json({ url }, 200);
    });

    api.openapi(routes.setPlan, async (c) => {
      operator(c);
      const { org } = c.req.valid("param");
      const found = billingOf(c);
      if (!(await orgs.exists(c.var.services.db, org))) throw notFound(`organization \`${org}\``);
      const { plan } = c.req.valid("json");
      await found.override(org, plan === "enterprise" ? "enterprise" : null);
      note(c, { org, details: { plan } });
      return c.json(await found.summary(org), 200);
    });
  },
};

export async function stripeWebhook(c: Context<AppEnv>, services: Services) {
  const found = services.billing;
  if (!found) return errorBody(c, 404, "no such route");
  const signature = c.req.header("stripe-signature");
  if (!signature) return errorBody(c, 400, "the Stripe-Signature header is missing");
  const payload = await c.req.text();
  let notice;
  try {
    notice = await found.notice(payload, signature);
  } catch (error) {
    if (isSignatureError(error)) return errorBody(c, 400, "the signature does not match");
    services.log({ level: "error", msg: "webhook failed", error: messageOf(error) });
    return errorBody(c, 500, "the event was not handled; Stripe will send it again");
  }
  return c.json({ received: true, handled: notice.kind }, 200);
}

const isSignatureError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "StripeSignatureVerificationError" ||
    (error as { type?: string }).type === "StripeSignatureVerificationError");
