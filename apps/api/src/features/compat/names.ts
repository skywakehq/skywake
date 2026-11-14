import type { Role } from "@skywake/contract";

import { mayUse } from "../../auth/roles.ts";
import type { Ctx } from "../../http/context.ts";
import { badRequest, HttpError, isMissing, notFound } from "../../http/errors.ts";
import { indexFor, signedIn } from "../../http/request.ts";
import { deleteIndex, MAIN } from "../indexes/lifecycle.ts";
import * as indexes from "../indexes/queries.ts";
import * as names from "./queries.ts";

export interface Place {
  index: string;
  branch: string;
}

export async function placeOf(c: Ctx, name: string, role: Role): Promise<Place | null> {
  const caller = await signedIn(c);
  const row = await c.var.services.places.find(caller.org, name, role !== "read");
  if (!row) return { index: name, branch: MAIN };
  return row.hidden ? null : { index: row.index, branch: row.branch };
}

export async function open(c: Ctx, name: string, role: Role) {
  const place = await placeOf(c, name, role);
  if (!place) throw missing(name);
  try {
    const { caller, index } = await indexFor(c, place.index, role);
    return { caller, index, branch: place.branch };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw missing(name);
    throw error;
  }
}

export const missing = (name: string) => notFound(`namespace \`${name}\``);

export async function list(c: Ctx, query: { prefix?: string; cursor?: string; size: number }) {
  const caller = await signedIn(c);
  const { db } = c.var.services;
  const rows = await names.list(db, caller.org);
  const hidden = new Set(rows.filter((row) => row.hidden).map((row) => row.name));
  const all = [
    ...(await indexes.list(db, caller.org))
      .filter((row) => mayUse(caller, row.name) && !hidden.has(row.name))
      .map((row) => row.name),
    ...rows.filter((row) => !row.hidden && mayUse(caller, row.index)).map((row) => row.name),
  ].sort();
  const { prefix = "", cursor, size } = query;
  const after = all.filter((name) => name.startsWith(prefix) && (!cursor || name > cursor));
  const page = after.slice(0, size);
  const more = after.length > size;
  return {
    namespaces: page.map((id) => ({ id })),
    ...(more ? { next_cursor: page.at(-1) } : {}),
  };
}

export async function remove(c: Ctx, name: string) {
  const { index, branch } = await open(c, name, "write");
  const { db } = c.var.services;
  const ref = { org: index.org, index: index.name };
  if (branch !== MAIN) {
    await index.store.deleteBranch(branch).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
    await indexes.removeBranch(db, { ...ref, name: branch });
    await names.remove(db, index.org, name);
    const own = await names.find(db, index.org, index.name);
    if (own?.hidden && (await names.branchesOf(db, index.org, index.name)).length === 0) {
      await destroy(c, index);
    }
    return;
  }
  if ((await names.branchesOf(db, index.org, index.name)).length === 0) {
    await indexFor(c, index.name, "admin");
    return destroy(c, index);
  }
  await index.store.write(MAIN, { deleteBy: { id: { not_in: [] } } }).catch(() => {
    throw badRequest("can't empty a namespace that has branches; delete its branches first");
  });
  await names.hide(db, index.org, index.name);
}

const destroy = (c: Ctx, index: Awaited<ReturnType<typeof indexFor>>["index"]) =>
  deleteIndex(c, index);
