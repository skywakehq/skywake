import { orgs as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import { newKey, randomId } from "../../auth/keys.ts";
import { allowOrgAdmin } from "../../auth/roles.ts";
import type { Ctx, Feature } from "../../http/context.ts";
import { conflict, notFound } from "../../http/errors.ts";
import { addressOf, operator, signedIn } from "../../http/request.ts";
import { requires } from "../billing/require.ts";
import { checked, lets } from "./allowlist.ts";
import { invoices, PRICES, usageOf } from "./invoices.ts";
import * as orgs from "./queries.ts";

/** An admin of `org`, which must be the caller's own organization. */
async function orgAdmin(c: Ctx, org: string) {
  const caller = await signedIn(c);
  allowOrgAdmin(caller);
  if (caller.org !== org) throw notFound(`organization \`${org}\``);
  return caller;
}

async function invoicesOf(c: Ctx, org: string) {
  await orgAdmin(c, org);
  const { config, db, usage } = c.var.services;
  await usage.flush();
  const today = new Date().toISOString().slice(0, 10);
  return invoices(await usageOf(db, org), { ...PRICES, ...config.prices }, today);
}

export const orgsFeature: Feature = {
  register(api) {
    api.openapi(routes.createOrg, async (c) => {
      operator(c);
      const { db } = c.var.services;
      const body = c.req.valid("json");
      const id = body.id ?? randomId("org_");
      const key = body.id ? null : newKey();
      const first = key && {
        id: key.id,
        hash: key.hash,
        name: "first admin key",
        role: "admin" as const,
        namespaces: "*",
        expires: null,
        // Made by the operator, so no person's leaving takes it.
        createdBy: null,
        createdByEmail: null,
      };
      if (!(await orgs.create(db, id, body.name, first ?? undefined))) {
        throw conflict(`organization \`${body.name}\` exists`);
      }
      note(c, { org: id, details: { name: body.name } });
      return c.json({ id, key: key?.key ?? null }, 201);
    });

    api.openapi(routes.renameOrg, async (c) => {
      operator(c);
      const { org } = c.req.valid("param");
      const { name } = c.req.valid("json");
      const done = await orgs.rename(c.var.services.db, org, name);
      if (done === "missing") throw notFound(`organization \`${org}\``);
      if (done === "taken") throw conflict(`organization \`${name}\` exists`);
      note(c, { org, details: { name } });
      return c.json({ id: org, name }, 200);
    });

    api.openapi(routes.getIpAllowlist, async (c) => {
      const { org } = c.req.valid("param");
      await orgAdmin(c, org);
      return c.json({ cidrs: await c.var.services.allowlists.get(org) }, 200);
    });

    api.openapi(routes.setIpAllowlist, async (c) => {
      const { org } = c.req.valid("param");
      const caller = await orgAdmin(c, org);
      const cidrs = checked(c.req.valid("json").cidrs);
      if (cidrs.length > 0) await requires(c, org, "ip_allowlist");
      const address = addressOf(c, caller);
      if (!lets(cidrs, address)) {
        throw conflict(`this list would lock you out: it leaves out your address, ${address}`);
      }
      await c.var.services.allowlists.set(org, cidrs);
      note(c, { details: { cidrs } });
      return c.json({ cidrs }, 200);
    });

    api.openapi(routes.listInvoices, async (c) => {
      const all = await invoicesOf(c, c.req.valid("param").org);
      return c.json(
        all.map(({ lines: _, ...summary }) => summary),
        200,
      );
    });

    api.openapi(routes.getInvoice, async (c) => {
      const { org, month } = c.req.valid("param");
      const found = (await invoicesOf(c, org)).find((invoice) => invoice.month === month);
      if (!found) throw notFound(`invoice \`${month}\``);
      return c.json(found, 200);
    });
  },
};
