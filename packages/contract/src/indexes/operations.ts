import { Time, z } from "../schemas.ts";
import { ColumnName } from "./fields.ts";
import { Filter } from "./filters.ts";

export const OperationKind = z.enum(["build", "warm", "collect", "copy"]).openapi("OperationKind");
export type OperationKind = z.output<typeof OperationKind>;
export const OperationStatus = z.enum(["running", "done", "failed"]).openapi("OperationStatus");
export type OperationStatus = z.output<typeof OperationStatus>;

export const Operation = z
  .object({
    id: z.string(),
    index: z.string(),
    branch: z.string().nullable().openapi({ description: "Null for work on the whole index." }),
    kind: OperationKind,
    status: OperationStatus,
    error: z.string().nullable().openapi({ description: "Why it failed." }),
    started: Time,
    finished: Time.nullable(),
  })
  .openapi("Operation", {
    description: "Work that goes on after its request answered. Ask for it by id to follow it.",
  });

export const RecallCheck = z
  .object({
    column: ColumnName.optional().openapi({ description: "The first vector column by default." }),
    queries: z.number().int().min(1).max(100).default(10).openapi({
      description: "How many documents' vectors to query with, picked at random.",
    }),
    topK: z.number().int().min(1).max(100).default(10),
    recall: z.number().gt(0).max(1).optional().openapi({
      description: "The recall target the queries use, as in `query`.",
    }),
    filter: Filter.optional(),
  })
  .openapi("RecallCheck");
export type RecallCheck = z.output<typeof RecallCheck>;

export const Recall = z
  .object({
    recall: z.number().openapi({
      description: "The share of the exact nearest documents the index found, on average.",
    }),
    queries: z.number().int().openapi({ description: "Queries run; fewer with few documents." }),
    found: z.number().openapi({ description: "Hits per query, on average." }),
    exact: z.number().openapi({ description: "Exact hits per query, on average." }),
  })
  .openapi("Recall");
