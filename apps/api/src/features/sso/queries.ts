import { and, asc, eq } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { ssoDomains } from "../../db/schema.ts";

export async function domains(db: Db, org: string) {
  const rows = await db
    .select({ domain: ssoDomains.domain })
    .from(ssoDomains)
    .where(eq(ssoDomains.org, org))
    .orderBy(asc(ssoDomains.domain));
  return rows.map((row) => row.domain);
}

export async function setDomains(db: Db, org: string, list: string[]) {
  await db.transaction(async (tx) => {
    await tx.delete(ssoDomains).where(eq(ssoDomains.org, org));
    if (list.length > 0) {
      await tx.insert(ssoDomains).values(list.map((domain) => ({ org, domain })));
    }
  });
}

export async function required(db: Db, org: string, email: string) {
  const domain = domainOf(email);
  if (!domain) return false;
  const found = await db
    .select({ org: ssoDomains.org })
    .from(ssoDomains)
    .where(and(eq(ssoDomains.org, org), eq(ssoDomains.domain, domain)))
    .limit(1);
  return found.length > 0;
}

export async function orgsFor(db: Db, domain: string) {
  const rows = await db
    .select({ org: ssoDomains.org })
    .from(ssoDomains)
    .where(eq(ssoDomains.domain, domain.toLowerCase()))
    .orderBy(asc(ssoDomains.org));
  return rows.map((row) => row.org);
}

export async function anyRequired(db: Db, org: string) {
  const found = await db
    .select({ org: ssoDomains.org })
    .from(ssoDomains)
    .where(eq(ssoDomains.org, org))
    .limit(1);
  return found.length > 0;
}

export function domainOf(email: string) {
  const at = email.lastIndexOf("@");
  return at < 0 ? null : email.slice(at + 1).toLowerCase();
}
