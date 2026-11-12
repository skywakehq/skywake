import { credentials as routes } from "@skywake/contract";

import { note } from "../../audit/note.ts";
import type { Feature } from "../../http/context.ts";
import { HttpError } from "../../http/errors.ts";
import { changeable } from "../../http/request.ts";
import { admitsDownload, admitsFiles, filesChanged } from "../billing/require.ts";
import * as branches from "../branches/queries.ts";
import { placeOf } from "./mint.ts";
import { passFor } from "./pass.ts";

export const credentialsFeature: Feature = {
  register(api) {
    api.openapi(routes.createCredentials, async (c) => {
      const { access } = c.req.valid("json");
      const { caller, ns } = await changeable(c, c.req.valid("param").namespace, access);
      const { config, credentials, db, stores } = c.var.services;
      const place = placeOf(stores.location(ns.region, ns.folder), config.s3.region);
      if (!credentials) {
        throw new HttpError(501, "this server has no STS role to mint credentials with");
      }
      if (!place) throw new HttpError(501, "this namespace's store is not in S3");
      await admitsDownload(c, ns.org);
      if (access !== "read") {
        await admitsFiles(c, ns.org);
        await filesChanged(c, ns.folder);
      }
      const guarded = await branches.protectedNames(db, ns.org, ns.name);
      const owners = ns.region === stores.defaultRegion ? config.heads : undefined;
      const minted = await credentials.mint(
        place,
        access,
        caller.actor,
        guarded,
        owners !== undefined,
      );
      const heads = owners && {
        nodes: owners.nodes,
        folder: place.prefix,
        pass: passFor(owners.token, place.prefix, access, guarded, minted.expiresAt),
      };
      note(c, { owner: ns.org, details: { access } });
      return c.json(
        {
          store: `s3://${place.bucket}/${place.prefix}`,
          region: place.region,
          endpoint: config.s3.endpoint,
          ...minted,
          access,
          heads: heads ?? null,
        },
        200,
      );
    });
  },
};
