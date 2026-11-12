import type { SearchIndex } from "../../auth/access.ts";
import type { Ctx } from "../../http/context.ts";
import { invalidAt } from "../../http/errors.ts";
import { start } from "../indexes/jobs.ts";
import * as indexes from "../indexes/queries.ts";
import { measureRecall } from "../indexes/recall.ts";
import { addAttributes, dropAttributes } from "../indexes/schemas.ts";
import { statsOf } from "../indexes/stats.ts";
import { sized } from "./embeds.ts";
import { open } from "./names.ts";
import { columnsOf, shownSchema } from "./schema.ts";

type Body = Record<string, unknown>;

export async function metadata(c: Ctx, name: string) {
  const { index, branch } = await open(c, name, "read");
  return metadataOf(c, index, branch);
}

export async function updateMetadata(c: Ctx, name: string, body: Body) {
  const { index, branch } = await open(c, name, "admin");
  const { db } = c.var.services;
  if (body.read_only !== undefined) {
    if (typeof body.read_only !== "boolean") throw invalidAt("read_only", "is true or false");
    await indexes.setReadOnly(db, index.org, index.name, body.read_only);
  }
  if ("pinning" in body) {
    const pinning = body.pinning as boolean | null | { replicas?: number };
    const replicas =
      pinning === null || pinning === false ? null : pinning === true ? 1 : (pinning.replicas ?? 1);
    await indexes.setPinned(db, index.org, index.name, replicas);
  }
  const row = (await indexes.find(db, index.org, index.name))!;
  return metadataOf(c, { ...index, ...row }, branch);
}

export async function schema(c: Ctx, name: string) {
  const { index } = await open(c, name, "read");
  return shownSchema(index.schema);
}

export async function updateSchema(c: Ctx, name: string, body: Body) {
  const { index: found } = await open(c, name, "admin");
  const asked = await sized(c, found.schema, columnsOf(body, undefined));
  const index =
    asked.drops.length > 0 ? await dropAttributes(c.var.services.db, found, asked.drops) : found;
  for (const column of asked.vectors) {
    const have = index.schema.vectors.find((known) => known.name === column.name);
    if (have?.dims !== column.dims) {
      throw invalidAt(`schema.${column.name}`, "vector attributes can't be added or changed");
    }
  }
  const grown = await addAttributes(c.var.services.db, index, asked.attributes);
  return shownSchema(grown.schema);
}

export async function warm(c: Ctx, name: string) {
  const { index, branch } = await open(c, name, "read");
  await start(c, index, branch, "warm", () => index.store.warm(branch));
  return { status: "ACCEPTED", message: "cache warm hint accepted" };
}

export async function recall(c: Ctx, name: string, body: Body) {
  const { index, branch } = await open(c, name, "read");
  if (body.rank_by !== undefined || body.filters !== undefined) {
    throw invalidAt("rank_by", "recall is measured on random documents' vectors, unfiltered");
  }
  const measured = await measureRecall(c, index, branch, {
    queries: Math.min(Number(body.num ?? 25), 100),
    topK: Math.min(Number(body.top_k ?? 10), 100),
  });
  return {
    avg_recall: measured.recall,
    avg_ann_count: measured.found,
    avg_exhaustive_count: measured.exact,
  };
}

async function metadataOf(c: Ctx, index: SearchIndex, branch: string) {
  const stats = await statsOf(index.store, branch);
  const [last] = await index.store.versions(branch, null, 1);
  const created = index.created.toISOString();
  const pinned = c.var.services.pinning.status(index);
  const unindexed = stats?.unindexed_rows ?? 0;
  return {
    approx_logical_bytes: stats?.bytes ?? 0,
    approx_row_count: stats?.rows ?? 0,
    created_at: created,
    updated_at: last ? new Date(last.time).toISOString() : created,
    encryption:
      index.kmsKeyId === null
        ? { mode: "default" }
        : { mode: "customer-managed", key_name: index.kmsKeyId },
    index:
      unindexed > 0
        ? { status: "updating", unindexed_rows: unindexed, unindexed_bytes: 0 }
        : { status: "up-to-date" },
    schema: shownSchema(index.schema),
    ...(index.pinnedReplicas === null
      ? {}
      : {
          pinning: {
            replicas: index.pinnedReplicas,
            status: {
              replicas: index.pinnedReplicas,
              ready_replicas: pinned?.replicas.filter((r) => r.warm).length ?? 0,
              updated_at: new Date().toISOString(),
              utilization: 0,
            },
          },
        }),
    ...(index.readOnly ? { read_only: true } : {}),
    sharding: { num_shards: index.shards },
  };
}
