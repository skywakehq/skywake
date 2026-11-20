import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { patternOfScope, type Role } from "@skywake/contract";
import { and, eq, gt, inArray, lte } from "drizzle-orm";

import { hashKey, newKey } from "../../auth/keys.ts";
import { roleFrom } from "../../auth/roles.ts";
import type { Db } from "../../db/client.ts";
import { keys, oauthCodes, oauthGrants, orgs } from "../../db/schema.ts";

const CODE_MS = 60_000;
export const ACCESS_SECONDS = 3600;
// A sign-in left unused this long ends; each refresh starts the wait again.
const IDLE_MS = 30 * 86_400_000;

const CODE = /^swc_[0-9a-f]{64}$/;
const REFRESH = /^swr_([0-9a-f]{16})_[0-9a-f]{64}$/;

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export interface Approval {
  org: string;
  client: string;
  redirect: string;
  challenge: string;
  device: string;
  role: Role;
  environment: string | null;
  only: string[];
  orgs: string[];
  createdBy: string;
  createdByEmail: string | null;
}

/** BASE64URL(SHA-256(verifier)) against the challenge, as RFC 7636's S256. */
export function verifies(verifier: string, challenge: string) {
  const made = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const asked = Buffer.from(challenge);
  return made.length === asked.length && timingSafeEqual(made, asked);
}

const same = (a: Buffer | null, b: Buffer) =>
  a !== null && a.length === b.length && timingSafeEqual(a, b);

export async function issueCode(db: Db, approval: Approval) {
  const now = new Date();
  await db.delete(oauthCodes).where(lte(oauthCodes.expires, now));
  const code = `swc_${hex(32)}`;
  const expires = new Date(now.getTime() + CODE_MS);
  await db.insert(oauthCodes).values({ ...approval, hash: hashKey(code), expires });
  return { code, expires };
}

/** The code's approval, used up: a code works once, even if the rest fails. */
export async function redeemCode(db: Db, code: string) {
  if (!CODE.test(code)) return null;
  const [row] = await db
    .delete(oauthCodes)
    .where(and(eq(oauthCodes.hash, hashKey(code)), gt(oauthCodes.expires, new Date())))
    .returning();
  return row ?? null;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Grant = typeof oauthGrants.$inferSelect;

async function accessKey(
  tx: Tx,
  grant: Omit<Grant, "keyId" | "refreshHash" | "previousHash" | "created">,
) {
  const key = newKey();
  const scope = { environment: grant.environment, only: grant.only };
  await tx.insert(keys).values({
    id: key.id,
    hash: key.hash,
    org: grant.org,
    name: `Skywake for Mac on ${grant.device}`,
    role: grant.role,
    ...scope,
    namespaces: patternOfScope(scope),
    expires: new Date(Date.now() + ACCESS_SECONDS * 1000),
    createdBy: grant.createdBy,
    createdByEmail: grant.createdByEmail,
  });
  return key;
}

const refreshToken = (grant: string) => `swr_${grant}_${hex(32)}`;

export async function startGrant(db: Db, approval: typeof oauthCodes.$inferSelect) {
  return db.transaction(async (tx) => {
    const now = new Date();
    await tx.delete(oauthGrants).where(lte(oauthGrants.expires, now));
    const id = hex(8);
    const refresh = refreshToken(id);
    const grant = {
      id,
      org: approval.org,
      client: approval.client,
      device: approval.device,
      role: approval.role,
      environment: approval.environment,
      only: approval.only,
      orgs: approval.orgs,
      createdBy: approval.createdBy,
      createdByEmail: approval.createdByEmail,
      expires: new Date(now.getTime() + IDLE_MS),
    };
    const key = await accessKey(tx, grant);
    await tx.insert(oauthGrants).values({ ...grant, keyId: key.id, refreshHash: hashKey(refresh) });
    return { grant, access: key.key, refresh };
  });
}

async function end(tx: Tx | Db, grant: Pick<Grant, "id" | "org" | "keyId">) {
  await tx.delete(oauthGrants).where(eq(oauthGrants.id, grant.id));
  await tx.delete(keys).where(and(eq(keys.org, grant.org), eq(keys.id, grant.keyId)));
}

/**
 * A new pair for a refresh token, or null. The old access key stops at once.
 * A refresh token used a second time means two holders, so the sign-in ends.
 */
export async function refresh(db: Db, token: string) {
  const id = REFRESH.exec(token)?.[1];
  if (!id) return null;
  const hash = hashKey(token);
  return db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(oauthGrants)
      .where(eq(oauthGrants.id, id))
      .for("update")
      .limit(1);
    if (!grant) return null;
    if (same(grant.previousHash, hash) || grant.expires <= new Date()) {
      await end(tx, grant);
      return null;
    }
    if (!same(grant.refreshHash, hash)) return null;
    // Someone removed the app's key in the console: that signs it out.
    const [live] = await tx
      .select({ id: keys.id })
      .from(keys)
      .where(and(eq(keys.org, grant.org), eq(keys.id, grant.keyId)))
      .limit(1);
    if (!live) {
      await end(tx, grant);
      return null;
    }
    await tx.delete(keys).where(eq(keys.id, grant.keyId));
    const key = await accessKey(tx, grant);
    const next = refreshToken(grant.id);
    await tx
      .update(oauthGrants)
      .set({
        keyId: key.id,
        refreshHash: hashKey(next),
        previousHash: grant.refreshHash,
        expires: new Date(Date.now() + IDLE_MS),
      })
      .where(eq(oauthGrants.id, grant.id));
    return { grant, access: key.key, refresh: next };
  });
}

/** Ends the sign-in a refresh token or its current access key belongs to. */
export async function revoke(db: Db, token: string) {
  const id = REFRESH.exec(token)?.[1];
  const hash = hashKey(token);
  if (id) {
    const [grant] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, id)).limit(1);
    if (grant && (same(grant.refreshHash, hash) || same(grant.previousHash, hash))) {
      await end(db, grant);
    }
    return;
  }
  const keyId = /^sw_([0-9a-f]{16})_/.exec(token)?.[1];
  if (!keyId) return;
  const [key] = await db.select().from(keys).where(eq(keys.id, keyId)).limit(1);
  if (!key || !same(key.hash, hash)) return;
  const [grant] = await db.select().from(oauthGrants).where(eq(oauthGrants.keyId, keyId)).limit(1);
  if (grant) await end(db, grant);
}

export async function orgNames(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: orgs.id, name: orgs.name })
    .from(orgs)
    .where(inArray(orgs.id, ids));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export const roleOf = (grant: { role: string }) => roleFrom(grant.role);
