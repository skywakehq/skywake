import type { indexes as contract } from "@skywake/contract";
import type { Index, IndexOpenOptions } from "@skywake/engine";

import { note } from "../../audit/note.ts";
import { randomId } from "../../auth/keys.ts";
import { allow, type Caller } from "../../auth/roles.ts";
import type { Ctx } from "../../http/context.ts";
import { conflict, forbidden, HttpError } from "../../http/errors.ts";
import { admitsIndex, requires } from "../billing/require.ts";
import { removeAndDelete } from "../deletions/queries.ts";
import { indexFor, signedIn } from "../../http/request.ts";
import { bucketFolder } from "../environments/buckets.ts";
import * as environments from "../environments/queries.ts";
import * as indexes from "./queries.ts";
import {
  addAttributes,
  engineSchema,
  firstSchema,
  newAttributes,
  type Written,
} from "./schemas.ts";

export const MAIN = "main";

interface NewIndex {
  name: string;
  region: string | undefined;
  schema: indexes.IndexRow["schema"];
  shards: number;
  encryption: { kms_key_id: string } | undefined;
  pinned?: contract.Pinned | null;
}

interface Target {
  store: Index;
  location: string;
  options: IndexOpenOptions;
}

export async function makeIndex(
  c: Ctx,
  caller: Caller,
  asked: NewIndex,
  fill: (target: Target) => Promise<void>,
) {
  allow(caller, "admin", asked.name);
  await admitsIndex(c, caller.org);
  if (asked.encryption) await requires(c, caller.org, "customer_keys");
  if (asked.pinned) await requires(c, caller.org, "pinning");
  const { db, stores } = c.var.services;
  const { region, own } = await environments.place(
    db,
    stores,
    caller.org,
    asked.name,
    asked.region,
  );
  const folder = own
    ? bucketFolder("ix", randomId("ix_"))
    : `${caller.org}/indexes/${randomId("ix_")}`;
  const row = {
    org: caller.org,
    name: asked.name,
    folder,
    region,
    schema: asked.schema,
    shards: asked.shards,
    kmsKeyId: asked.encryption?.kms_key_id ?? null,
    pinnedReplicas: asked.pinned?.replicas ?? null,
  };
  if (!(await indexes.create(db, row))) throw conflict(`index \`${asked.name}\` exists`);
  // A copy into a customer's bucket signs with that bucket's keys.
  const options = { ...indexes.openOptions(row), keys: stores.keysOf(region) };
  try {
    const store = stores.index(region, folder, options);
    await fill({ store, location: stores.location(region, folder), options });
  } catch (error) {
    await indexes.remove(db, caller.org, asked.name);
    throw error;
  }
  await indexes.addBranch(db, { org: caller.org, index: asked.name, name: MAIN }, null);
  return (await indexes.find(db, caller.org, asked.name))!;
}

/**
 * Deletes an index: its row now, and its data from the bucket by the deletion
 * queue, tried at once and retried until it is gone.
 */
export async function deleteIndex(c: Ctx, index: { org: string; name: string; folder: string }) {
  const { db, stores, deleter } = c.var.services;
  if (!(await removeAndDelete(db, "index", index.org, index.name))) return;
  stores.close(index.folder);
  void deleter.drain().catch(() => {});
}

export async function writable(
  c: Ctx,
  name: string,
  branch: string,
  written: Written[] = [],
  docs: contract.Document[] = [],
  path = "",
) {
  const found = await indexFor(c, name, "write").catch(async (error: unknown) => {
    const missing = error instanceof HttpError && error.status === 404;
    if (!missing || branch !== MAIN || docs.length === 0) throw error;
    const caller = await signedIn(c);
    const schema = firstSchema(docs, path);
    const asked = { name, region: undefined, schema, shards: 1, encryption: undefined };
    // Another write may make it first; then this one writes to that.
    const made = await makeIndex(c, caller, asked, ({ store }) =>
      store.create(engineSchema(schema)),
    ).then(
      () => true,
      (error: unknown) => {
        if (error instanceof HttpError && error.status === 409) return false;
        throw error;
      },
    );
    if (made) note(c, { details: { created: name } });
    return indexFor(c, name, "write");
  });
  if (found.index.readOnly) throw forbidden(`index \`${name}\` is read-only`);
  const added = newAttributes(found.index.schema, written);
  const index = await addAttributes(c.var.services.db, found.index, added);
  return { caller: found.caller, index };
}
