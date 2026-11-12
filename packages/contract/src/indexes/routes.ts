import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, noContent, page, signedIn } from "../http.ts";
import { z } from "../schemas.ts";
import {
  IndexBranch,
  IndexBranchInfo,
  IndexVersion,
  Merged,
  MergeIndexBranch,
  NewIndexBranch,
  RestoreIndexBranch,
} from "./branches.ts";
import {
  DeleteDocuments,
  Document,
  DocumentPage,
  ScanQuery,
  Upsert,
  Write,
  WriteCounts,
  Written,
} from "./documents.ts";
import { IndexVersionId } from "./fields.ts";
import { BATCH_MAX, USAGE_DAYS_MAX, VERSIONS_MAX } from "./limits.ts";
import { Operation, Recall, RecallCheck } from "./operations.ts";
import {
  Aggregate,
  FusedHits,
  Groups,
  Hits,
  Hybrid,
  Multi,
  MultiResults,
  Order,
  Query,
  Rank,
  RankedHits,
  Rows,
  Search,
  SearchHits,
} from "./queries.ts";
import { CopyIndex, Index, IndexInfo, NewIndex, UpdateIndex } from "./schema.ts";
import { IndexUsage } from "./usage.ts";

const indexParam = z.string().openapi({
  param: { name: "index", in: "path" },
  description: "An index of your organization, such as `prod/products`. Encode `/` as `%2F`.",
  example: "prod%2Fproducts",
});

const branchParam = z.string().openapi({
  param: { name: "branch", in: "path" },
  description: "A branch of the index, such as `main`. Encode `/` as `%2F`.",
  example: "main",
});

export const IndexParams = z.object({ index: indexParam });
export const DocumentParams = z.object({
  index: indexParam,
  branch: branchParam,
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "A document id. Whole digits are a number id first, then a string id.",
    example: "42",
  }),
});
export const IndexBranchParams = z.object({ index: indexParam, branch: branchParam });

const tags = ["indexes"];

export const listIndexes = createRoute({
  method: "get",
  path: "/indexes",
  operationId: "listIndexes",
  tags,
  summary: "The indexes the caller can reach, in name order.",
  security: signedIn,
  request: { query: z.object(page("indexes", "name")) },
  responses: { 200: json(z.array(Index), "The indexes."), ...errors(401) },
});

export const createIndex = createRoute({
  method: "post",
  path: "/indexes",
  operationId: "createIndex",
  tags,
  summary: "Makes an index with an empty `main` branch.",
  security: signedIn,
  request: { body: body(NewIndex) },
  responses: { 201: json(Index, "The index."), ...errors(400, 401, 403, 409) },
});

export const getIndex = createRoute({
  method: "get",
  path: "/indexes/{index}",
  operationId: "getIndex",
  tags,
  security: signedIn,
  request: { params: IndexParams },
  responses: { 200: json(IndexInfo, "The index."), ...errors(401, 403, 404) },
});

export const updateIndex = createRoute({
  method: "patch",
  path: "/indexes/{index}",
  operationId: "updateIndex",
  tags,
  summary: "Adds attributes, pins or unpins the index, or makes it read-only or writable.",
  description: "Takes effect at once, on every branch; nothing is rebuilt.",
  security: signedIn,
  request: { params: IndexParams, body: body(UpdateIndex) },
  responses: { 200: json(Index, "The index after."), ...errors(400, 401, 403, 404) },
});

export const deleteIndex = createRoute({
  method: "delete",
  path: "/indexes/{index}",
  operationId: "deleteIndex",
  tags,
  summary: "Deletes an index, every branch and all its data.",
  security: signedIn,
  request: { params: IndexParams },
  responses: { 204: noContent, ...errors(401, 403, 404) },
});

export const listIndexBranches = createRoute({
  method: "get",
  path: "/indexes/{index}/branches",
  operationId: "listIndexBranches",
  tags,
  summary: "The branches, in name order.",
  security: signedIn,
  request: { params: IndexParams, query: z.object(page("branches", "name")) },
  responses: { 200: json(z.array(IndexBranch), "The branches."), ...errors(401, 403, 404) },
});

export const forkIndexBranch = createRoute({
  method: "post",
  path: "/indexes/{index}/branches",
  operationId: "forkIndexBranch",
  tags,
  summary: "Forks a branch. Nothing is copied; each then sees only its own writes.",
  security: signedIn,
  request: { params: IndexParams, body: body(NewIndexBranch) },
  responses: { 201: json(IndexBranch, "The new branch."), ...errors(400, 401, 403, 404, 409) },
});

export const listIndexVersions = createRoute({
  method: "get",
  path: "/indexes/{index}/branches/{branch}/versions",
  operationId: "listIndexVersions",
  tags,
  summary: "The branch's versions, newest first: one for every change.",
  description:
    "Fork or restore one to go back in time. Versions replaced longer ago than the index's " +
    "`retention_days` may be gone once `collect` ran.",
  security: signedIn,
  request: {
    params: IndexBranchParams,
    query: z.object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(VERSIONS_MAX)
        .optional()
        .openapi({
          description: `The most versions to return, at most ${VERSIONS_MAX}. 20 by default.`,
        }),
      after: IndexVersionId.optional().openapi({
        description: "The next page: the version of the last one of the page before.",
      }),
    }),
  },
  responses: { 200: json(z.array(IndexVersion), "The versions."), ...errors(400, 401, 403, 404) },
});

export const restoreIndexBranch = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/restore",
  operationId: "restoreIndexBranch",
  tags,
  summary: "Moves the branch back to an older version.",
  description:
    "Makes a new version with the documents of the old one, so the history stays and nothing " +
    "is deleted. A version replaced longer ago than the index's `retention_days` is refused.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(RestoreIndexBranch) },
  responses: {
    200: json(IndexVersion, "The branch's new version."),
    ...errors(400, 401, 403, 404, 409),
  },
});

export const getIndexBranch = createRoute({
  method: "get",
  path: "/indexes/{index}/branches/{branch}",
  operationId: "getIndexBranch",
  tags,
  security: signedIn,
  request: { params: IndexBranchParams },
  responses: { 200: json(IndexBranchInfo, "The branch."), ...errors(401, 403, 404) },
});

export const mergeIndexBranch = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/merge",
  operationId: "mergeIndexBranch",
  tags,
  summary: "Adds the writes of another branch to this one.",
  description:
    "The writes `from` made since it forked, or since it was last merged here. Where both " +
    "branches wrote one document, `from`'s write wins. Its new attributes come too. The " +
    "next build puts the merged documents into the clusters; until then they are searched " +
    "exactly.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(MergeIndexBranch) },
  responses: { 200: json(Merged, "Merged."), ...errors(400, 401, 403, 404) },
});

export const deleteIndexBranch = createRoute({
  method: "delete",
  path: "/indexes/{index}/branches/{branch}",
  operationId: "deleteIndexBranch",
  tags,
  summary: "Deletes a branch. `main` stays while the index does.",
  security: signedIn,
  request: { params: IndexBranchParams },
  responses: { 204: noContent, ...errors(401, 403, 404, 409) },
});

export const upsertDocuments = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/documents",
  operationId: "upsertDocuments",
  tags,
  summary: "Writes documents. Each replaces any earlier one with its id.",
  description:
    `At most ${BATCH_MAX} documents and 32 MiB. Durable when it answers. An attribute the ` +
    "schema lacks is added with the type of its value: `string`, `number`, `bool`, " +
    "`strings` or `numbers`. Writing to `main` of an index that does not exist makes it, " +
    "with a cosine vector column for each vector, for a caller who may make it.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(Upsert) },
  responses: { 200: json(Written, "Written."), ...errors(400, 401, 403, 404, 409, 413, 503) },
});

export const listDocuments = createRoute({
  method: "get",
  path: "/indexes/{index}/branches/{branch}/documents",
  operationId: "listDocuments",
  tags,
  summary: "The documents, in pages by id: number ids first, then string ids.",
  description:
    "Reads every segment of the branch, so it is for browsing and exports, not a hot path.",
  security: signedIn,
  request: { params: IndexBranchParams, query: ScanQuery },
  responses: { 200: json(DocumentPage, "A page."), ...errors(400, 401, 403, 404) },
});

export const getDocument = createRoute({
  method: "get",
  path: "/indexes/{index}/branches/{branch}/documents/{id}",
  operationId: "getDocument",
  tags,
  summary: "One document by id.",
  security: signedIn,
  request: { params: DocumentParams },
  responses: { 200: json(Document, "The document."), ...errors(401, 403, 404) },
});

export const deleteDocuments = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/documents/delete",
  operationId: "deleteDocuments",
  tags,
  summary: "Deletes documents by id. Ids that are not there are ignored.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(DeleteDocuments) },
  responses: { 200: json(Written, "Deleted."), ...errors(400, 401, 403, 404, 409) },
});

export const writeDocuments = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/write",
  operationId: "writeDocuments",
  tags,
  summary: "Upserts, patches and deletes, with conditions and by filter, as one change.",
  description:
    `At most ${BATCH_MAX} of each and 32 MiB. Durable when it answers. New attributes, and ` +
    "a new index from its upserts, are made as by `upsertDocuments`.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(Write) },
  responses: { 200: json(WriteCounts, "What it did."), ...errors(400, 401, 403, 404, 409, 413) },
});

export const exportDocuments = createRoute({
  method: "get",
  path: "/indexes/{index}/branches/{branch}/export",
  operationId: "exportDocuments",
  tags,
  summary: "Every document of the branch as it is now, one JSON object per line.",
  description:
    "With `format=parquet`, a Parquet file instead: an `id` column (as text), a list of " +
    "floats per vector column and a typed column per attribute; sparse and late interaction " +
    "vectors as JSON text.",
  security: signedIn,
  request: {
    params: IndexBranchParams,
    query: z.object({ format: z.enum(["ndjson", "parquet"]).default("ndjson") }),
  },
  responses: {
    200: {
      description: "Documents, newline-delimited, in no set order; or a Parquet file.",
      content: {
        "application/x-ndjson": { schema: Document },
        "application/vnd.apache.parquet": { schema: z.string().openapi({ format: "binary" }) },
      },
    },
    ...errors(401, 403, 404),
  },
});

export const copyIndex = createRoute({
  method: "post",
  path: "/indexes/{index}/copy",
  operationId: "copyIndex",
  tags,
  summary: "Makes a new index from a branch of this one, as its `main`.",
  description:
    "Copies the data the branch uses now, with the same schema and shards. Writes to either " +
    "index never reach the other.",
  security: signedIn,
  request: { params: IndexParams, body: body(CopyIndex) },
  responses: { 201: json(Index, "The new index."), ...errors(400, 401, 403, 404, 409) },
});

export const orderDocuments = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/order",
  operationId: "orderDocuments",
  tags,
  summary: "The documents that pass the filter, in the order of an attribute.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(Order) },
  responses: { 200: json(Rows, "The documents."), ...errors(400, 401, 403, 404) },
});

export const rankDocuments = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/rank",
  operationId: "rankDocuments",
  tags,
  summary: "The documents that pass the filter, best first by a score: sparse or late-interaction.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(Rank) },
  responses: { 200: json(RankedHits, "The documents."), ...errors(400, 401, 403, 404) },
});

export const aggregateDocuments = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/aggregate",
  operationId: "aggregateDocuments",
  tags,
  summary: "Counts, sums, means, minimums and maximums, overall or by group.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(Aggregate) },
  responses: { 200: json(Groups, "The groups."), ...errors(400, 401, 403, 404) },
});

export const multiQuery = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/multi",
  operationId: "multiQuery",
  tags,
  summary: "Several queries, searches, orders and aggregations on one snapshot.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(Multi) },
  responses: { 200: json(MultiResults, "One result per request."), ...errors(400, 401, 403, 404) },
});

export const queryIndex = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/query",
  operationId: "queryIndex",
  tags,
  summary: "The nearest documents to a vector that pass the filter, nearest first.",
  description:
    "A field that does not fit the schema answers 400 with its JSON path in `path`, such as " +
    "`filter.and[1].price.lt`.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(Query) },
  responses: { 200: json(Hits, "The hits."), ...errors(400, 401, 403, 404, 503) },
});

export const searchIndex = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/search",
  operationId: "searchIndex",
  tags,
  summary: "The documents that best match a text query by BM25, best first.",
  description:
    "Exact over every document, the ones written since the last build too. A field that " +
    "does not fit the schema answers 400 with its JSON path in `path`.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(Search) },
  responses: { 200: json(SearchHits, "The hits."), ...errors(400, 401, 403, 404, 503) },
});

export const hybridQuery = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/hybrid",
  operationId: "hybridQuery",
  tags,
  summary: "Vector and text searches on one snapshot, fused by reciprocal rank.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(Hybrid) },
  responses: { 200: json(FusedHits, "The hits."), ...errors(400, 401, 403, 404, 503) },
});

export const buildIndex = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/build",
  operationId: "buildIndex",
  tags,
  summary: "Starts clustering the rows written so far, so queries read less.",
  description: "Answers once the build has started. Writes and queries go on meanwhile.",
  security: signedIn,
  request: { params: IndexBranchParams },
  responses: { 202: json(Operation, "The build, running."), ...errors(401, 403, 404) },
});

export const warmIndex = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/warm",
  operationId: "warmIndex",
  tags,
  summary: "Starts reading the branch into the cache, so the next queries are fast.",
  description:
    "A hint before queries come, as when a user opens an app. Answers once it has started.",
  security: signedIn,
  request: { params: IndexBranchParams },
  responses: { 202: json(Operation, "The warming, running."), ...errors(401, 403, 404) },
});

export const collectIndex = createRoute({
  method: "post",
  path: "/indexes/{index}/collect",
  operationId: "collectIndex",
  tags,
  summary: "Starts deleting the data no branch uses any more.",
  description:
    "Keeps every branch as it is, and each version replaced within the index's " +
    "`retention_days` (every version when that is null). Data younger than eight days always " +
    "stays, so writes in progress are safe. Answers once it has started.",
  security: signedIn,
  request: { params: IndexParams },
  responses: { 202: json(Operation, "The collection, running."), ...errors(401, 403, 404) },
});

export const getIndexOperation = createRoute({
  method: "get",
  path: "/indexes/{index}/operations/{operation}",
  operationId: "getIndexOperation",
  tags,
  summary: "A build, warming or collection the index started, and how it went.",
  security: signedIn,
  request: { params: IndexParams.extend({ operation: z.string().max(64) }) },
  responses: { 200: json(Operation, "The operation."), ...errors(401, 403, 404) },
});

export const checkRecall = createRoute({
  method: "post",
  path: "/indexes/{index}/branches/{branch}/recall",
  operationId: "checkRecall",
  tags,
  summary: "Measures how many of the true nearest documents queries find.",
  description:
    "Queries with the vectors of documents picked at random, once as asked and once " +
    "exactly, and compares them. Each pair counts as two queries.",
  security: signedIn,
  request: { params: IndexBranchParams, body: body(RecallCheck) },
  responses: { 200: json(Recall, "The measured recall."), ...errors(400, 401, 403, 404) },
});

export const getIndexUsage = createRoute({
  method: "get",
  path: "/indexes/{index}/usage",
  operationId: "getIndexUsage",
  tags,
  summary: "Queries, writes, embeddings, reranks and size per day, over every branch.",
  security: signedIn,
  request: {
    params: IndexParams,
    query: z.object({
      days: z.coerce
        .number()
        .int()
        .min(1)
        .max(USAGE_DAYS_MAX)
        .optional()
        .openapi({ description: "Days back from today, today included. 14 by default." }),
    }),
  },
  responses: { 200: json(IndexUsage, "The days."), ...errors(401, 403, 404) },
});
