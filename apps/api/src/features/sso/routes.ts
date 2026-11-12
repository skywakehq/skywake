import { sso as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import type { Ctx, Feature } from "../../http/context.ts";
import { operator } from "../../http/request.ts";
import { notFound } from "../../http/errors.ts";
import { requires } from "../billing/require.ts";
import * as orgs from "../orgs/queries.ts";
import * as sso from "./queries.ts";

async function adminOrg(c: Ctx, org: string) {
  operator(c);
  if (!(await orgs.exists(c.var.services.db, org))) throw notFound(`organization \`${org}\``);
}

export const ssoFeature: Feature = {
  register(api) {
    api.openapi(routes.getSsoPolicy, async (c) => {
      const { org } = c.req.valid("param");
      await adminOrg(c, org);
      return c.json({ required_domains: await sso.domains(c.var.services.db, org) }, 200);
    });

    api.openapi(routes.setSsoPolicy, async (c) => {
      const { org } = c.req.valid("param");
      await adminOrg(c, org);
      const { db } = c.var.services;
      const list = [...new Set(c.req.valid("json").required_domains)].sort();
      if (list.length > 0) await requires(c, org, "sso");
      await sso.setDomains(db, org, list);
      note(c, { org, details: { domains: list } });
      return c.json({ required_domains: list }, 200);
    });

    api.openapi(routes.ssoDomainOrgs, async (c) => {
      operator(c);
      const { domain } = c.req.valid("param");
      return c.json({ orgs: await sso.orgsFor(c.var.services.db, domain) }, 200);
    });
  },
};
