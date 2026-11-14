import { randomBytes } from "node:crypto";

import { environments as routes } from "@skywake/contract";
import { forgetStoreKeys } from "@skywake/engine";

import type { StoreAccess } from "../../db/schema.ts";
import { note } from "../../audit/note.ts";
import { allow, mayUse } from "../../auth/roles.ts";
import type { Feature } from "../../http/context.ts";
import { HttpError, badRequest, conflict, messageOf, notFound } from "../../http/errors.ts";
import { signedIn } from "../../http/request.ts";
import { seal } from "../../security/sealed.ts";
import { bucketRegion, keysContext, verifyBucket } from "./buckets.ts";
import * as environments from "./queries.ts";

/** The external ID a customer's role must require: one per organization. */
export function externalIdOf(org: string) {
  return `skywake-${org}`;
}

export const environmentsFeature: Feature = {
  register(api) {
    api.openapi(routes.listRegions, async (c) => {
      await signedIn(c);
      return c.json(c.var.services.stores.list(), 200);
    });

    api.openapi(routes.listEnvironments, async (c) => {
      const caller = await signedIn(c);
      const all = await environments.list(c.var.services.db, caller.org);
      return c.json(
        all.filter((env) => mayUse(caller, `${env.name}/`)),
        200,
      );
    });

    api.openapi(routes.createEnvironment, async (c) => {
      const caller = await signedIn(c);
      const { name } = c.req.valid("json");
      allow(caller, "admin", `${name}/`);
      const { db } = c.var.services;
      if (!(await environments.ensure(db, caller.org, name))) {
        throw conflict(`environment \`${name}\` exists`);
      }
      note(c, { details: { environment: name } });
      const environment = (await environments.list(db, caller.org)).find(
        (env) => env.name === name,
      )!;
      return c.json(environment, 201);
    });

    api.openapi(routes.getStoreTrust, async (c) => {
      const caller = await signedIn(c);
      const { environment } = c.req.valid("param");
      allow(caller, "admin", `${environment}/`);
      const principal = c.var.services.config.byobPrincipal ?? null;
      return c.json({ principal, externalId: externalIdOf(caller.org) }, 200);
    });

    api.openapi(routes.setEnvironmentStore, async (c) => {
      const caller = await signedIn(c);
      const { environment } = c.req.valid("param");
      allow(caller, "admin", `${environment}/`);
      const { store, access: asked } = c.req.valid("json");
      const { db, config, stores, buckets } = c.var.services;
      const found = (await environments.list(db, caller.org)).find(
        (env) => env.name === environment,
      );
      if (!found) throw notFound(`environment \`${environment}\``);
      if (await environments.holdsData(db, caller.org, environment)) {
        throw conflict(
          `environment \`${environment}\` holds namespaces or indexes; its bucket can't change`,
        );
      }

      let access: StoreAccess;
      if (asked.type === "aws_role") {
        access = { ...asked, externalId: externalIdOf(caller.org) };
      } else {
        if (!config.secretKey) {
          throw new HttpError(501, "this server keeps no secrets: SKYWAKE_API_SECRET_KEY is unset");
        }
        access = {
          type: "keys",
          accessKeyId: asked.accessKeyId,
          secret: seal(
            config.secretKey,
            asked.secretAccessKey,
            keysContext(caller.org, environment),
          ),
          endpoint: asked.endpoint ?? null,
          region: asked.region,
        };
      }

      // Throwaway keys under their own id, so a failed check leaves nothing behind.
      const trial = `check:${randomBytes(8).toString("hex")}`;
      try {
        const keys = await buckets.keys(trial, access, caller.org, environment);
        await verifyBucket(store, keys);
      } catch (error) {
        throw badRequest(`the bucket can't be used: ${messageOf(error)}`);
      } finally {
        buckets.stop(trial);
        forgetStoreKeys(trial);
      }

      await environments.setStore(db, caller.org, environment, { store, access });
      const region = bucketRegion(caller.org, environment);
      buckets.stop(region);
      stores.forget(region);
      note(c, { details: { environment, store, access: asked.type } });
      const shown = (await environments.list(db, caller.org)).find(
        (env) => env.name === environment,
      );
      return c.json(shown!.store!, 200);
    });

    api.openapi(routes.removeEnvironmentStore, async (c) => {
      const caller = await signedIn(c);
      const { environment } = c.req.valid("param");
      allow(caller, "admin", `${environment}/`);
      const { db, stores, buckets } = c.var.services;
      const found = (await environments.list(db, caller.org)).find(
        (env) => env.name === environment,
      );
      if (!found) throw notFound(`environment \`${environment}\``);
      if (await environments.holdsData(db, caller.org, environment)) {
        throw conflict(`environment \`${environment}\` holds namespaces or indexes`);
      }
      await environments.setStore(db, caller.org, environment, null);
      const region = bucketRegion(caller.org, environment);
      buckets.stop(region);
      stores.forget(region);
      forgetStoreKeys(region);
      note(c, { details: { environment } });
      return c.body(null, 204);
    });
  },
};
