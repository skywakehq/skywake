import { asc, eq } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { environments } from "../../db/schema.ts";
import type { Stores } from "../../engine/stores.ts";

export async function ensure(db: Db, org: string, name: string) {
  const made = await db
    .insert(environments)
    .values({ org, name })
    .onConflictDoNothing()
    .returning({ name: environments.name });
  return made.length > 0;
}

export async function place(
  db: Db,
  stores: Stores,
  org: string,
  name: string,
  asked: string | undefined,
) {
  const region = stores.pick(asked);
  const environment = name.includes("/") ? name.slice(0, name.indexOf("/")) : "default";
  await ensure(db, org, environment);
  return region;
}

export async function list(db: Db, org: string) {
  const rows = await db
    .select()
    .from(environments)
    .where(eq(environments.org, org))
    .orderBy(asc(environments.name));
  return rows.map((row) => ({ name: row.name, created: row.created.toISOString() }));
}
