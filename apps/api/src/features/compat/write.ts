import { indexes as contract } from "@skywake/contract";
import type { DocId } from "@skywake/engine";

import { note } from "../../audit/note.ts";
import type { SearchIndex } from "../../auth/access.ts";
import type { Ctx } from "../../http/context.ts";
import { badRequest, forbidden, HttpError, invalidAt } from "../../http/errors.ts";
import { indexFor, signedIn } from "../../http/request.ts";
import { Texts } from "../indexes/embeddings.ts";
import { MAIN, makeIndex } from "../indexes/lifecycle.ts";
import * as rules from "../indexes/rules/index.ts";
import { kindsOf } from "../indexes/rules/kinds.ts";
import { addAttributes, dropAttributes, engineSchema, newAttributes } from "../indexes/schemas.ts";
import { reembedded, sized } from "./embeds.ts";
import { filterOf } from "./filters.ts";
import { missing, placeOf } from "./names.ts";
import * as names from "./queries.ts";
import { type Columns, columnsOf, isVectorKey, metricOf, ourName } from "./schema.ts";
import { decodeVector } from "./vectors.ts";

type Schema = contract.IndexSchema;
type Body = Record<string, unknown>;
type Row = Record<string, unknown> & { id: DocId };
type AttributeValue = NonNullable<contract.Document["attributes"]>[string];

export async function write(c: Ctx, name: string, body: Body) {
  const started = performance.now();
  const metric = metricOf(body.distance_metric, "distance_metric");
  const columns = columnsOf(body.schema, metric);
  const upserts = [
    ...rowsOf(body.upsert_rows, "upsert_rows"),
    ...rowsOfColumns(body.upsert_columns, "upsert_columns"),
  ];
  const patches = [
    ...rowsOf(body.patch_rows, "patch_rows"),
    ...rowsOfColumns(body.patch_columns, "patch_columns"),
  ];
  const { index: found, branch, asked } = await target(c, name, body, columns, upserts, metric);
  if (found.readOnly) throw forbidden(`namespace \`${name}\` is read-only`);
  const kept =
    asked.drops.length > 0 ? await dropAttributes(c.var.services.db, found, asked.drops) : found;
  const index = await grown(c, kept, asked, [...upserts, ...patches]);

  const kinds = kindsOf(index.schema);
  const filter = (input: unknown, path: string) =>
    input === undefined || input === null ? undefined : filterOf(input, path, kinds);
  const patchBy = body.patch_by_filter as { filters?: unknown; patch?: unknown } | undefined;
  const restaged = await reembedded(
    index,
    branch,
    patches.map((row, i) => {
      const { id, ...attributes } = row;
      if (Object.keys(attributes).some((key) => isVectorKey(index.schema, key))) {
        throw invalidAt(`patch_rows[${i}]`, "vectors can't be patched; upsert the row");
      }
      return { id, attributes: attributes as Record<string, AttributeValue | null> };
    }),
    body.patch_condition !== undefined && body.patch_condition !== null,
  );
  const ours: contract.Write = {
    upserts: [
      ...upserts.map((row, i) => documentOf(index.schema, row, `upsert_rows[${i}]`)),
      ...restaged.upserts,
    ],
    patches: restaged.patches,
    deletes: (body.deletes as DocId[] | undefined) ?? [],
    upsertIf: filter(body.upsert_condition, "upsert_condition"),
    patchIf: filter(body.patch_condition, "patch_condition"),
    deleteIf: filter(body.delete_condition, "delete_condition"),
    deleteBy: filter(body.delete_by_filter, "delete_by_filter"),
    patchBy: patchBy && {
      filter: filterOf(patchBy.filters, "patch_by_filter.filters", kinds),
      attributes: (patchBy.patch ?? {}) as Record<string, AttributeValue | null>,
    },
    returnAffectedIds: body.return_affected_ids === true,
  };
  const texts = new Texts();
  const engine = rules.write(index.schema, ours, texts);
  const bill = c.var.services.usage.bill(index);
  await bill.admit("writes");
  await texts.embed(c.var.services.models, bill);
  // Only ids that were there are billed. The answer still counts every id sent.
  const { upsertedIds, patchedIds, deletedIds, missing, ...exact } = await index.store.write(
    branch,
    { ...engine, exactDeletes: true },
  );
  bill.count("writes", exact.upserted + exact.patched);
  bill.count("deletes", exact.deleted);
  const counts = { ...exact, deleted: exact.deleted + missing };
  const written = Buffer.byteLength(JSON.stringify(ours));
  bill.wrote(written);
  const affected = counts.upserted + counts.patched + counts.deleted;
  const ids = { upserted_ids: upsertedIds, patched_ids: patchedIds, deleted_ids: deletedIds };
  return {
    status: "OK",
    message: `${affected} rows affected`,
    rows_affected: affected,
    rows_upserted: counts.upserted,
    rows_patched: counts.patched,
    rows_deleted: counts.deleted,
    ...Object.fromEntries(Object.entries(ids).filter(([, list]) => list?.length)),
    billing: { billable_logical_bytes_written: written },
    performance: { server_total_ms: Math.round(performance.now() - started) },
  };
}

async function target(
  c: Ctx,
  name: string,
  body: Body,
  columns: Columns,
  upserts: Row[],
  metric: Schema["vectors"][number]["metric"] | undefined,
): Promise<{ index: SearchIndex; branch: string; asked: Columns }> {
  const caller = await signedIn(c);
  const { db } = c.var.services;
  let place = await placeOf(c, name, "write");
  if (!place) {
    await names.remove(db, caller.org, name);
    place = { index: name, branch: MAIN };
  }
  try {
    const { index } = await indexFor(c, place.index, "write");
    return { index, branch: place.branch, asked: await sized(c, index.schema, columns) };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
  }
  const asked = await sized(c, undefined, columns);
  const wanted = body.create_namespace === true || upserts.length > 0;
  if (body.create_namespace === false || !wanted || place.branch !== MAIN) throw missing(name);
  const schema = firstSchema(asked, upserts, metric);
  const sharding = body.sharding as { num_shards?: number } | undefined;
  const encryption = body.encryption as { mode?: string; key_name?: string } | undefined;
  const kms = encryption?.mode === "customer-managed" ? encryption.key_name : undefined;
  const made = await makeIndex(
    c,
    caller,
    {
      name,
      region: undefined,
      schema,
      shards: sharding?.num_shards ?? 1,
      encryption: kms ? { kms_key_id: kms } : undefined,
    },
    ({ store }) => store.create(engineSchema(schema)),
  ).then(
    () => true,
    (error: unknown) => {
      if (error instanceof HttpError && error.status === 409) return false;
      throw error;
    },
  );
  if (made) note(c, { details: { created: name } });
  return { index: (await indexFor(c, name, "write")).index, branch: MAIN, asked };
}

function firstSchema(
  asked: Columns,
  rows: Row[],
  metric: Schema["vectors"][number]["metric"] | undefined,
): Schema {
  const vectors = [...asked.vectors];
  const vector = rows.find((row) => row.vector !== undefined && row.vector !== null)?.vector;
  if (vector !== undefined && !vectors.some((column) => column.name === "vector")) {
    const dims = decodeVector(vector, "upsert_rows[].vector").length;
    vectors.push({ name: "vector", dims, metric: metric ?? "cosine" });
  }
  const known = { vectors, attributes: asked.attributes };
  const written = rows.map((row, i) => ({ values: plain(known, row), path: `upsert_rows[${i}]` }));
  const checked = contract.IndexSchema.safeParse({
    vectors,
    attributes: [...asked.attributes, ...newAttributes(known, written)],
  });
  if (!checked.success) {
    throw badRequest(`the write makes no namespace: ${checked.error.issues[0]!.message}`);
  }
  return checked.data;
}

async function grown(
  c: Ctx,
  index: SearchIndex,
  asked: Columns,
  rows: Row[],
): Promise<SearchIndex> {
  for (const column of asked.vectors) {
    const have = index.schema.vectors.find((known) => known.name === column.name);
    if (!have) throw invalidAt(`schema.${column.name}`, "vector attributes can't be added later");
    if (have.dims !== column.dims) {
      throw invalidAt(`schema.${column.name}`, `the namespace's vectors have ${have.dims} dims`);
    }
  }
  const { db } = c.var.services;
  let grownIndex = await addAttributes(db, index, asked.attributes);
  const written = rows.map((row, i) => ({
    values: plain(grownIndex.schema, row),
    path: `rows[${i}]`,
  }));
  grownIndex = await addAttributes(db, grownIndex, newAttributes(grownIndex.schema, written));
  return grownIndex;
}

function plain(schema: Pick<Schema, "vectors">, row: Row) {
  const { id: _, ...rest } = row;
  return Object.fromEntries(
    Object.entries(rest).filter(
      ([key]) => key !== "vector" && !schema.vectors.some((c) => c.name === ourName(key)),
    ),
  );
}

function documentOf(schema: Schema, row: Row, path: string): contract.Document {
  const vectors: Record<string, number[]> = {};
  const attributes: NonNullable<contract.Document["attributes"]> = {};
  const kinds = kindsOf(schema);
  for (const [key, value] of Object.entries(row)) {
    if (key === "id" || value === null || value === undefined) continue;
    if (isVectorKey(schema, key)) vectors[ourName(key)] = decodeVector(value, `${path}.${key}`);
    else attributes[key] = kinds.get(key) === "sparse" ? sparseOf(value) : (value as never);
  }
  return { id: row.id, vectors, attributes };
}

function sparseOf(value: unknown): AttributeValue {
  if (!value || typeof value !== "object" || "indices" in value) return value as never;
  const entries = Object.entries(value as Record<string, number>);
  return {
    indices: entries.map(([dim]) => Number(dim)),
    values: entries.map(([, w]) => w),
  } as never;
}

function rowsOf(input: unknown, path: string): Row[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw invalidAt(path, "is a list of rows");
  return input.map((row, i) => {
    if (!row || typeof row !== "object" || !("id" in row)) {
      throw invalidAt(`${path}[${i}]`, "a row needs an `id`");
    }
    return row as Row;
  });
}

function rowsOfColumns(input: unknown, path: string): Row[] {
  if (input === undefined || input === null) return [];
  const columns = input as Record<string, unknown>;
  if (!Array.isArray(columns.id)) throw invalidAt(`${path}.id`, "is a list of ids");
  const count = columns.id.length;
  const values = Object.fromEntries(
    Object.entries(columns).map(([key, column]) => {
      if (Array.isArray(column) && column.length === count) return [key, column];
      if (key === "vector" && column !== null) {
        const flat = decodeVector(column, `${path}.vector`);
        const dims = flat.length / count;
        return [key, Array.from({ length: count }, (_, i) => flat.slice(i * dims, (i + 1) * dims))];
      }
      throw invalidAt(`${path}.${key}`, `has ${count} values, one per id`);
    }),
  );
  return Array.from({ length: count }, (_, i) => {
    const row: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(values)) {
      if (column[i] !== null && column[i] !== undefined) row[key] = column[i];
    }
    return row as Row;
  });
}
