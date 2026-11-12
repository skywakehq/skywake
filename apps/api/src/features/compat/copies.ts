import type { SearchIndex } from "../../auth/access.ts";
import { randomId } from "../../auth/keys.ts";
import type { Ctx } from "../../http/context.ts";
import { conflict, invalidAt, notFound } from "../../http/errors.ts";
import { signedIn } from "../../http/request.ts";
import { start } from "../indexes/jobs.ts";
import { makeIndex } from "../indexes/lifecycle.ts";
import * as indexes from "../indexes/queries.ts";
import { statsOf } from "../indexes/stats.ts";
import { missing, open } from "./names.ts";
import * as names from "./queries.ts";

type Body = Record<string, unknown>;

interface Source {
  source_namespace: string;
  source_api_key?: string;
  dest_encryption?: { mode?: string; key_name?: string };
}
export async function branchFrom(c: Ctx, name: string, body: Body) {
  const started = performance.now();
  const { source_namespace: from } = sourceOf(body.branch_from_namespace, "branch_from_namespace");
  const { index, branch } = await open(c, from, "write");
  await mustBeFree(c, name);
  const { db } = c.var.services;
  const ref = { org: index.org, index: index.name, name: randomId("ns_") };
  await indexes.addBranch(db, ref, branch);
  try {
    await index.store.fork(branch, ref.name, null, index.retentionDays);
    if (!(await names.add(db, { org: index.org, name, index: index.name, branch: ref.name }))) {
      throw conflict(`namespace \`${name}\` exists`);
    }
  } catch (error) {
    await index.store.deleteBranch(ref.name).catch(() => {});
    await indexes.removeBranch(db, ref);
    throw error;
  }
  return copied(index, ref.name, started);
}
export async function copyFrom(c: Ctx, name: string, body: Body) {
  const started = performance.now();
  const { copy, index, branch } = await copyPlan(c, name, body);
  await copy();
  return copied(index, branch, started);
}
export async function startCopy(c: Ctx, name: string, body: Body) {
  const { copy, index, branch } = await copyPlan(c, name, body);
  const caller = await signedIn(c);
  const operation = await start(c, index, branch, "copy", copy, caller.org);
  return { token: tokenOf([index.org, index.name, operation.id]) };
}
export async function poll(c: Ctx, name: string, token: string) {
  const caller = await signedIn(c);
  const [org, index, id] = partsOf(token);
  const found = await indexes.findOperation(c.var.services.db, org, index, id);
  // Only the organization that started the copy may follow it.
  const asker = found?.requestedBy ?? found?.org;
  if (!found || found.kind !== "copy" || asker !== caller.org) {
    throw notFound(`operation \`${token}\``);
  }
  const shown = indexes.shownOperation(found);
  if (shown.status === "running") return { status: "running", start_time: shown.started };
  const result =
    shown.status === "done"
      ? {
          success: {
            status: "OK",
            message: "copied",
            rows_affected: await copiedRows(c, name),
            billing: {},
            performance: {},
          },
        }
      : { error: { status_code: 500, detail: { status: "error", error: shown.error } } };
  return { status: "finished", start_time: shown.started, finish_time: shown.finished, result };
}
async function copiedRows(c: Ctx, name: string) {
  const copy = await open(c, name, "read").catch(() => null);
  return copy ? ((await statsOf(copy.index.store, copy.branch))?.rows ?? 0) : 0;
}

async function copyPlan(c: Ctx, name: string, body: Body) {
  const source = sourceOf(body.copy_from_namespace, "copy_from_namespace");
  const { index, branch } = source.source_api_key
    ? await openWithKey(c, source.source_namespace, source.source_api_key)
    : await open(c, source.source_namespace, "read");
  await mustBeFree(c, name);
  const caller = await signedIn(c);
  const kms =
    source.dest_encryption?.mode === "customer-managed"
      ? source.dest_encryption.key_name
      : undefined;
  const asked = {
    name,
    region: undefined,
    schema: index.schema,
    shards: index.shards,
    encryption: kms ? { kms_key_id: kms } : undefined,
  };
  const copy = async () => {
    await makeIndex(c, caller, asked, ({ location, options }) =>
      index.store.copy(branch, location, options),
    );
  };
  return { copy, index, branch };
}
async function openWithKey(c: Ctx, name: string, key: string) {
  const { auth, access, db } = c.var.services;
  const owner = (await auth.caller(key))!;
  const row = await names.find(db, owner.org, name);
  if (row?.hidden) throw missing(name);
  const index = await access.index(owner, row?.index ?? name, "read").catch(() => {
    throw missing(name);
  });
  return { index, branch: row?.branch ?? "main" };
}
async function mustBeFree(c: Ctx, name: string) {
  const caller = await signedIn(c);
  const { db } = c.var.services;
  const taken =
    (await names.find(db, caller.org, name)) ?? (await indexes.find(db, caller.org, name));
  if (taken) throw conflict(`namespace \`${name}\` exists; copies go to a new namespace`);
}

function sourceOf(input: unknown, path: string): Source {
  const source = typeof input === "string" ? { source_namespace: input } : (input as Source);
  if (!source || typeof source.source_namespace !== "string") {
    throw invalidAt(path, "names the source namespace");
  }
  return source;
}

async function copied(index: SearchIndex, branch: string, started: number) {
  const rows = (await statsOf(index.store, branch))?.rows ?? 0;
  return {
    status: "OK",
    message: `${rows} rows copied`,
    rows_affected: rows,
    billing: { billable_logical_bytes_written: 0 },
    performance: { server_total_ms: Math.round(performance.now() - started) },
  };
}

const tokenOf = (parts: string[]) => Buffer.from(JSON.stringify(parts)).toString("base64url");

function partsOf(token: string): [string, string, string] {
  try {
    const parts = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(parts) && parts.length === 3 && parts.every((p) => typeof p === "string")) {
      return parts as [string, string, string];
    }
  } catch {}
  throw notFound(`operation \`${token}\``);
}
