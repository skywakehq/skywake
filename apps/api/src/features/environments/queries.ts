import { and, asc, eq, like, notLike, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { environments, indexes, namespaces, type StoreAccess } from "../../db/schema.ts";
import type { Stores } from "../../engine/stores.ts";
import { badRequest } from "../../http/errors.ts";
import { pendingIn } from "../deletions/queries.ts";
import { bucketRegion } from "./buckets.ts";

export async function ensure(db: Db, org: string, name: string) {
  const made = await db
    .insert(environments)
    .values({ org, name })
    .onConflictDoNothing()
    .returning({ name: environments.name });
  return made.length > 0;
}

/** The environment a namespace or index name belongs to. */
export function environmentOf(name: string) {
  return name.includes("/") ? name.slice(0, name.indexOf("/")) : "default";
}

/**
 * Where a new namespace or index goes: the environment's own bucket when it has
 * one (`own`), else the region asked for or the server's default.
 */
export async function place(
  db: Db,
  stores: Stores,
  org: string,
  name: string,
  asked: string | undefined,
): Promise<{ region: string; own: boolean }> {
  const environment = environmentOf(name);
  await ensure(db, org, environment);
  const [row] = await db
    .select({ store: environments.store })
    .from(environments)
    .where(and(eq(environments.org, org), eq(environments.name, environment)));
  if (row?.store) {
    if (asked !== undefined) {
      throw badRequest(`environment \`${environment}\` keeps its data in its own bucket`);
    }
    const region = bucketRegion(org, environment);
    await stores.ready(region);
    return { region, own: true };
  }
  return { region: stores.pick(asked), own: false };
}

export interface ShownStore {
  store: string;
  access:
    | { type: "aws_role"; roleArn: string; externalId: string; region: string }
    | { type: "keys"; accessKeyId: string; endpoint: string | null; region: string };
  verified: string | null;
}

function shownStore(row: typeof environments.$inferSelect): ShownStore | null {
  if (!row.store || !row.storeAccess) return null;
  const access = row.storeAccess;
  return {
    store: row.store,
    // Never the secret, sealed or not.
    access:
      access.type === "aws_role"
        ? access
        : {
            type: "keys",
            accessKeyId: access.accessKeyId,
            endpoint: access.endpoint,
            region: access.region,
          },
    verified: row.storeVerified?.toISOString() ?? null,
  };
}

export async function list(db: Db, org: string) {
  const rows = await db
    .select()
    .from(environments)
    .where(eq(environments.org, org))
    .orderBy(asc(environments.name));
  return rows.map((row) => ({
    name: row.name,
    created: row.created.toISOString(),
    store: shownStore(row),
  }));
}

/** Whether any namespace or index lives in the environment yet. */
export async function holdsData(db: Db, org: string, environment: string) {
  const inside = (column: typeof namespaces.name | typeof indexes.name) =>
    environment === "default"
      ? notLike(column, "%/%")
      : like(column, `${environment.replace(/[\\%_]/g, "\\$&")}/%`);
  const [ns] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(namespaces)
    .where(and(eq(namespaces.org, org), inside(namespaces.name)));
  const [ix] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(indexes)
    .where(and(eq(indexes.org, org), inside(indexes.name)));
  if ((ns?.n ?? 0) + (ix?.n ?? 0) > 0) return true;
  // Folders still being deleted need the bucket's access until they are gone.
  return pendingIn(db, bucketRegion(org, environment));
}

export async function setStore(
  db: Db,
  org: string,
  environment: string,
  store: { store: string; access: StoreAccess } | null,
) {
  await db
    .update(environments)
    .set({
      store: store?.store ?? null,
      storeAccess: store?.access ?? null,
      storeVerified: store ? new Date() : null,
    })
    .where(and(eq(environments.org, org), eq(environments.name, environment)));
}

/** The customer's role for the bucket a namespace lives in, if the API reaches it through one. */
export async function customerRole(db: Db, org: string, name: string) {
  const [row] = await db
    .select({ access: environments.storeAccess })
    .from(environments)
    .where(and(eq(environments.org, org), eq(environments.name, environmentOf(name))));
  const access = row?.access;
  if (access?.type !== "aws_role") return undefined;
  return { arn: access.roleArn, externalId: access.externalId };
}
