import { oauth as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import type { Feature } from "../../http/context.ts";
import { HttpError } from "../../http/errors.ts";
import { signedIn } from "../../http/request.ts";
import { scopeFor } from "../logins/routes.ts";
import * as oauth from "./queries.ts";

// One message for every refused code or token, so a guess learns nothing.
const refused = () => new HttpError(400, "this sign-in is not valid any more; sign in again");

type Issued = Awaited<ReturnType<typeof oauth.startGrant>>;

export const oauthFeature: Feature = {
  register(api) {
    api.openapi(routes.createCode, async (c) => {
      const caller = await signedIn(c);
      const asked = c.req.valid("json");
      const scope = scopeFor(caller, asked.environment, asked.role);
      const orgs = [...new Set([caller.org, ...Object.keys(caller.memberships ?? {})])];
      const { code, expires } = await oauth.issueCode(c.var.services.db, {
        org: caller.org,
        client: asked.client_id,
        redirect: asked.redirect_uri,
        challenge: asked.code_challenge,
        device: asked.device,
        role: asked.role,
        ...scope,
        orgs,
        createdBy: caller.actor,
        createdByEmail: caller.email ?? null,
      });
      note(c, { details: { client: asked.client_id, environment: scope.environment } });
      return c.json({ code, expires: expires.toISOString() }, 201);
    });

    api.openapi(routes.token, async (c) => {
      const { db } = c.var.services;
      const asked = c.req.valid("json");
      let issued: Issued | null;
      if (asked.grant_type === "authorization_code") {
        const approval = await oauth.redeemCode(db, asked.code);
        if (
          !approval ||
          approval.client !== asked.client_id ||
          approval.redirect !== asked.redirect_uri ||
          !oauth.verifies(asked.code_verifier, approval.challenge)
        ) {
          throw refused();
        }
        issued = await oauth.startGrant(db, approval);
      } else {
        issued = await oauth.refresh(db, asked.refresh_token);
      }
      if (!issued || issued.grant.client !== asked.client_id) throw refused();
      const { grant } = issued;
      const names = await oauth.orgNames(db, grant.orgs);
      const organization = names.find((org) => org.id === grant.org) ?? {
        id: grant.org,
        name: grant.org,
      };
      c.header("cache-control", "no-store");
      return c.json(
        {
          access_token: issued.access,
          token_type: "Bearer" as const,
          expires_in: oauth.ACCESS_SECONDS,
          refresh_token: issued.refresh,
          organization,
          organizations: names,
          environment: grant.environment,
          role: oauth.roleOf(grant),
          email: grant.createdByEmail,
        },
        200,
      );
    });

    api.openapi(routes.revoke, async (c) => {
      await oauth.revoke(c.var.services.db, c.req.valid("json").token);
      return c.body(null, 204);
    });
  },
};
