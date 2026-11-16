import { randomBytes } from "node:crypto";

import { patternOfScope } from "@skywake/contract";
import { and, count, eq, gt, lte } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { keys, logins } from "../../db/schema.ts";
import { conflict, HttpError } from "../../http/errors.ts";
import type { NewKeyRow } from "../keys/queries.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PENDING_MAX = 1000;
const LOGIN_MS = 10 * 60_000;

export interface NewLogin {
  keyId: string;
  keyHash: Buffer;
  device: string;
}

function newCode() {
  const letters = [...randomBytes(8)].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

export const codeOf = (text: string) => text.toUpperCase();

export async function start(db: Db, login: NewLogin) {
  const now = new Date();
  await db.delete(logins).where(lte(logins.expires, now));
  const [pending] = await db.select({ n: count() }).from(logins);
  if ((pending?.n ?? 0) >= PENDING_MAX) {
    throw new HttpError(503, "too many sign-ins are waiting; try again in a few minutes");
  }
  const [taken] = await db
    .select({ id: keys.id })
    .from(keys)
    .where(eq(keys.id, login.keyId))
    .limit(1);
  if (taken) throw conflict("a key with this id exists; make a new key");
  const expires = new Date(now.getTime() + LOGIN_MS);
  const [added] = await db
    .insert(logins)
    .values({ ...login, code: newCode(), expires })
    .onConflictDoNothing()
    .returning({ code: logins.code, expires: logins.expires });
  if (!added) throw conflict("a sign-in with this key is already waiting; make a new key");
  return added;
}

export async function find(db: Db, code: string) {
  const [row] = await db
    .select({ code: logins.code, device: logins.device, expires: logins.expires })
    .from(logins)
    .where(and(eq(logins.code, code), gt(logins.expires, new Date())))
    .limit(1);
  return row ?? null;
}

export type Grant = Omit<NewKeyRow, "id" | "hash" | "name">;

export async function approve(db: Db, org: string, code: string, grant: Grant) {
  return db.transaction(async (tx) => {
    const [login] = await tx
      .delete(logins)
      .where(and(eq(logins.code, code), gt(logins.expires, new Date())))
      .returning();
    if (!login) return null;
    const key = { ...grant, id: login.keyId, hash: login.keyHash, name: `cli on ${login.device}` };
    await tx.insert(keys).values({ ...key, org, namespaces: patternOfScope(key) });
    return key;
  });
}
