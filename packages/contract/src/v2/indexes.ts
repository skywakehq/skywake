import { createRoute, z } from "@hono/zod-openapi";

import { DocId } from "../indexes/documents.ts";
import { Filter } from "../indexes/filters.ts";
import { IndexSchema, UpdateIndex } from "../indexes/schema.ts";
import {
  body,
  Branch,
  BranchName,
  BranchQuery,
  done,
  errors,
  IndexParams,
  json,
  listOf,
  Merge,
  NewBranch,
  PageQuery,
  security,
  ShortName,
  Time,
} from "./common.ts";

const tags = ["indexes"];

export const RowId = DocId;

export const Row = z
  .object({ id: RowId })
  .catchall(z.unknown())
  .openapi("Row", {
    description:
      "An id and any fields. A string is searchable by keywords and filterable; a list of " +
      "numbers is a vector.",
    example: { id: 1, text: "red running shoes", price: 89 },
  });

export const NewRow = z
  .object({ id: RowId.optional().openapi({ description: "Made for you when missing." }) })
  .catchall(z.unknown())
  .openapi("NewRow");

export const Hit = Row.extend({
  score: z.number().openapi({ description: "Larger is better." }),
}).openapi("Hit");

export const Embed = z
  .union([z.object({ model: z.string().min(1).max(256) }).strict(), z.literal(false)])
  .openapi("Embed", {
    description:
      "The model that embeds `text` fields for search by meaning. The environment's model by " +
      "default; `false` searches by keywords only.",
  });

export const IndexSummary = z
  .object({ name: z.string(), region: z.string(), created: Time })
  .openapi("IndexSummary");

export const IndexInfo = IndexSummary.extend({
  schema: IndexSchema,
  rows: z.number().int().nullable(),
  bytes: z.number().int().nullable(),
  read_only: z.boolean(),
  retention_days: z.number().int().nullable(),
  branches: z.array(z.string()),
}).openapi("IndexInfo");

export const NewIndex = z
  .object({
    name: ShortName.openapi({ example: "products" }),
    schema: IndexSchema.optional().openapi({
      description: "Columns chosen up front. Without it, the first upsert decides them.",
    }),
    region: z.string().optional(),
    embed: Embed.optional(),
  })
  .openapi("NewIndexV2");

export const Upserted = z
  .object({
    ids: z.array(RowId),
    count: z.number().int(),
  })
  .openapi("Upserted");

export const Counted = z.object({ count: z.number().int() }).openapi("Counted");

export const Update = z
  .object({
    id: RowId.optional(),
    ids: z.array(RowId).max(10_000).optional(),
    filter: Filter.optional(),
    fields: z.record(z.string(), z.unknown()).openapi({
      description: "Fields to set; `null` removes one.",
      example: { stock: 3 },
    }),
  })
  .refine((u) => [u.id, u.ids, u.filter].filter((x) => x !== undefined).length === 1, {
    message: "give one of `id`, `ids` or `filter`",
  })
  .openapi("Update");

export const Delete = z
  .object({
    id: RowId.optional(),
    ids: z.array(RowId).max(10_000).optional(),
    filter: Filter.optional(),
  })
  .refine((d) => [d.id, d.ids, d.filter].filter((x) => x !== undefined).length === 1, {
    message: "give one of `id`, `ids` or `filter`",
  })
  .openapi("Delete");

export const Mode = z.enum(["auto", "meaning", "keywords"]).openapi("Mode", {
  description:
    "`auto` runs meaning and keywords together and merges them, or keywords alone when the " +
    "index has no embedding model.",
});

export const Query = z
  .object({
    text: z.string().min(1).max(4096).optional(),
    vector: z.array(z.number()).min(1).optional().openapi({
      description: "Your own vector; skips embedding.",
    }),
    filter: Filter.optional(),
    limit: z.number().int().min(1).max(1000).optional().openapi({ description: "10 by default." }),
    mode: Mode.optional(),
    sort: z
      .record(z.string(), z.enum(["asc", "desc"]))
      .optional()
      .openapi({
        description: "With no text and no vector, lists rows in this order.",
        example: { price: "asc" },
      }),
    fields: z.array(z.string()).max(64).optional().openapi({
      description: "Which fields come back. All but vectors by default.",
    }),
    ...BranchQuery,
  })
  .openapi("QueryV2");

export const Aggregate = z
  .object({
    group_by: z.union([z.string(), z.array(z.string()).max(8)]).optional(),
    count: z.boolean().optional().openapi({ description: "True by default." }),
    sum: z.union([z.string(), z.array(z.string())]).optional(),
    avg: z.union([z.string(), z.array(z.string())]).optional(),
    min: z.union([z.string(), z.array(z.string())]).optional(),
    max: z.union([z.string(), z.array(z.string())]).optional(),
    filter: Filter.optional(),
    ...BranchQuery,
  })
  .openapi("AggregateV2");

export const Group = z
  .object({
    group: z.record(z.string(), z.unknown()),
    count: z.number().int().optional(),
    sum: z.record(z.string(), z.number()).optional(),
    avg: z.record(z.string(), z.number()).optional(),
    min: z.record(z.string(), z.number()).optional(),
    max: z.record(z.string(), z.number()).optional(),
  })
  .openapi("Group");

export const Version = z
  .object({ id: z.string(), created: Time, rows: z.number().int().nullable() })
  .openapi("Version");

export const Restore = z
  .object({
    to: z.string().min(1).max(100).openapi({ description: "A version id, or a time." }),
    ...BranchQuery,
  })
  .openapi("RestoreV2");

export const Copy = z
  .object({
    name: ShortName,
    environment: ShortName.optional().openapi({ description: "This one by default." }),
  })
  .openapi("CopyV2");

export const Merged = z
  .object({ rows: z.number().int().openapi({ description: "Rows and deletes brought in." }) })
  .openapi("IndexMerged");

const branchParams = IndexParams.extend({
  branch: BranchName.openapi({ param: { name: "branch", in: "path" }, example: "draft" }),
});
const rowParams = IndexParams.extend({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "42" }),
});

const route = <T extends Parameters<typeof createRoute>[0]>(r: T) =>
  createRoute({ tags, security, ...r });

export const listIndexes = route({
  method: "get",
  path: "/indexes",
  operationId: "listIndexes",
  request: { query: z.object(PageQuery) },
  responses: { 200: json(listOf(IndexSummary, "IndexList"), "The indexes.") },
});

export const createIndex = route({
  method: "post",
  path: "/indexes",
  operationId: "createIndex",
  summary: "Makes an index with settings chosen up front. Upserting to a new name also makes one.",
  request: { body: body(NewIndex) },
  responses: { 201: json(IndexInfo, "The index."), ...errors(400, 402, 403, 409) },
});

export const getIndex = route({
  method: "get",
  path: "/indexes/{index}",
  operationId: "getIndex",
  request: { params: IndexParams },
  responses: { 200: json(IndexInfo, "The index."), ...errors(403, 404) },
});

export const configureIndex = route({
  method: "patch",
  path: "/indexes/{index}",
  operationId: "configureIndex",
  request: { params: IndexParams, body: body(UpdateIndex) },
  responses: { 200: json(IndexInfo, "The index."), ...errors(400, 403, 404) },
});

export const destroyIndex = route({
  method: "delete",
  path: "/indexes/{index}",
  operationId: "destroyIndex",
  request: { params: IndexParams },
  responses: { 204: done, ...errors(403, 404) },
});

export const upsertRows = route({
  method: "post",
  path: "/indexes/{index}/rows",
  operationId: "upsertRows",
  summary:
    "Writes one row or many, replacing rows with the same id. Makes the index if it is missing, " +
    "and adds new fields to it.",
  request: {
    params: IndexParams,
    query: z.object(BranchQuery),
    body: body(z.union([NewRow, z.array(NewRow).min(1).max(10_000)])),
  },
  responses: { 200: json(Upserted, "The rows written."), ...errors(400, 402, 403, 404, 413) },
});

export const updateRows = route({
  method: "patch",
  path: "/indexes/{index}/rows",
  operationId: "updateRows",
  summary: "Changes some fields of rows chosen by id or by filter.",
  request: { params: IndexParams, query: z.object(BranchQuery), body: body(Update) },
  responses: { 200: json(Counted, "Rows changed."), ...errors(400, 403, 404) },
});

export const deleteRows = route({
  method: "post",
  path: "/indexes/{index}/rows/delete",
  operationId: "deleteRows",
  request: { params: IndexParams, query: z.object(BranchQuery), body: body(Delete) },
  responses: { 200: json(Counted, "Rows deleted."), ...errors(400, 403, 404) },
});

export const getRow = route({
  method: "get",
  path: "/indexes/{index}/rows/{id}",
  operationId: "getRow",
  request: { params: rowParams, query: z.object({ ...BranchQuery }) },
  responses: { 200: json(Row, "The row."), ...errors(403, 404) },
});

export const listRows = route({
  method: "get",
  path: "/indexes/{index}/rows",
  operationId: "listRows",
  summary: "Every row, a page at a time, in id order.",
  request: { params: IndexParams, query: z.object({ ...BranchQuery, ...PageQuery }) },
  responses: { 200: json(listOf(Row, "RowList"), "The rows."), ...errors(403, 404) },
});

export const queryIndex = route({
  method: "post",
  path: "/indexes/{index}/query",
  operationId: "queryIndex",
  summary: "Searches by meaning and keywords, filters, and sorts.",
  request: { params: IndexParams, body: body(Query) },
  responses: { 200: json(listOf(Hit, "HitList"), "Best first."), ...errors(400, 403, 404) },
});

export const countRows = route({
  method: "post",
  path: "/indexes/{index}/count",
  operationId: "countRows",
  request: {
    params: IndexParams,
    body: body(z.object({ filter: Filter.optional(), ...BranchQuery }).openapi("CountV2")),
  },
  responses: { 200: json(Counted, "The count."), ...errors(400, 403, 404) },
});

export const aggregateRows = route({
  method: "post",
  path: "/indexes/{index}/aggregate",
  operationId: "aggregateRows",
  request: { params: IndexParams, body: body(Aggregate) },
  responses: { 200: json(listOf(Group, "GroupList"), "The groups."), ...errors(400, 403, 404) },
});

export const listIndexBranches = route({
  method: "get",
  path: "/indexes/{index}/branches",
  operationId: "listIndexBranches",
  request: { params: IndexParams, query: z.object(PageQuery) },
  responses: { 200: json(listOf(Branch, "BranchList"), "The branches."), ...errors(403, 404) },
});

export const forkIndex = route({
  method: "post",
  path: "/indexes/{index}/branches",
  operationId: "forkIndex",
  request: { params: IndexParams, body: body(NewBranch) },
  responses: { 201: json(Branch, "The new branch."), ...errors(400, 403, 404, 409) },
});

export const destroyIndexBranch = route({
  method: "delete",
  path: "/indexes/{index}/branches/{branch}",
  operationId: "destroyIndexBranch",
  request: { params: branchParams },
  responses: { 204: done, ...errors(403, 404, 409) },
});

export const mergeIndex = route({
  method: "post",
  path: "/indexes/{index}/merges",
  operationId: "mergeIndex",
  request: { params: IndexParams, body: body(Merge) },
  responses: { 200: json(Merged, "Merged."), ...errors(400, 403, 404, 409) },
});

export const listVersions = route({
  method: "get",
  path: "/indexes/{index}/versions",
  operationId: "listVersions",
  request: { params: IndexParams, query: z.object({ ...BranchQuery, ...PageQuery }) },
  responses: { 200: json(listOf(Version, "VersionList"), "Newest first."), ...errors(403, 404) },
});

export const restoreIndex = route({
  method: "post",
  path: "/indexes/{index}/restore",
  operationId: "restoreIndex",
  request: { params: IndexParams, body: body(Restore) },
  responses: { 200: json(Version, "The branch's new version."), ...errors(400, 403, 404, 409) },
});

export const copyIndex = route({
  method: "post",
  path: "/indexes/{index}/copy",
  operationId: "copyIndex",
  request: { params: IndexParams, body: body(Copy) },
  responses: { 201: json(IndexSummary, "The new index."), ...errors(400, 402, 403, 404, 409) },
});

export const routes = [
  listIndexes,
  createIndex,
  getIndex,
  configureIndex,
  destroyIndex,
  upsertRows,
  updateRows,
  deleteRows,
  getRow,
  listRows,
  queryIndex,
  countRows,
  aggregateRows,
  listIndexBranches,
  forkIndex,
  destroyIndexBranch,
  mergeIndex,
  listVersions,
  restoreIndex,
  copyIndex,
];
