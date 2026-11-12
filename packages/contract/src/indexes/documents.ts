import { z } from "../schemas.ts";
import { VectorValue } from "./fields.ts";
import { Condition, Filter } from "./filters.ts";
import { BATCH_MAX, SCAN_MAX } from "./limits.ts";

export const DocId = z
  .union([z.string().min(1).max(256), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)])
  .openapi("DocId", {
    description: "A string, or a whole number from 0; a UUID when the schema's `id` is `uuid`.",
  });

export const AttributeValue = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
    z.array(z.array(z.number())),
    z.record(z.string(), z.unknown()),
  ])
  .openapi("AttributeValue", {
    description:
      "An object's fields are attributes of their own: `{author: {name}}` is `author.name`.",
  });

export const Document = z
  .object({
    id: DocId,
    vectors: z
      .record(z.string(), VectorValue)
      .default({})
      .openapi({
        description:
          "A vector for every vector column of the schema. A column with `embed` also takes " +
          "text, or an image, which the server embeds.",
        example: { embedding: [0.1, 0.2, 0.3] },
      }),
    attributes: z
      .record(z.string(), AttributeValue)
      .optional()
      .openapi({ example: { tag: "billing", price: 9 } }),
  })
  .openapi("Document");
export type Document = z.output<typeof Document>;

const returnAffectedIds = z.boolean().optional().openapi({
  description: "Also return the ids the write changed, one for each count. Off by default.",
});

const affectedIds = (what: string) =>
  z
    .array(DocId)
    .optional()
    .openapi({ description: `With \`returnAffectedIds\`: ${what}.` });

export const Upsert = z
  .object({ documents: z.array(Document).min(1).max(BATCH_MAX), returnAffectedIds })
  .openapi("Upsert");

const billed = (what: string) => z.number().int().optional().openapi({ description: what });

export const Billing = z
  .object({
    queries: billed("Queries, one per request of a multi-query."),
    writes: billed("Documents written or patched."),
    deletes: billed("Documents deleted."),
    embeddings: billed("Texts and images embedded."),
    reranks: billed("Reranks."),
  })
  .openapi("Billing", { description: "What this request counted toward the bill." });

export const Written = z
  .object({
    count: z.number().int().openapi({ description: "Documents written or deleted." }),
    upserted_ids: affectedIds("the ids written, by an upsert"),
    deleted_ids: affectedIds("the ids deleted, by a delete"),
    billing: Billing,
  })
  .openapi("Written");

export const DeleteDocuments = z
  .object({ ids: z.array(DocId).min(1).max(BATCH_MAX), returnAffectedIds })
  .openapi("DeleteDocuments");

const Changes = z
  .record(z.string(), AttributeValue.nullable())
  .openapi({ description: "Attributes to set; `null` removes one.", example: { stock: 3 } });

export const Write = z
  .object({
    upserts: z.array(Document).max(BATCH_MAX).optional(),
    patches: z
      .array(z.object({ id: DocId, attributes: Changes }))
      .max(BATCH_MAX)
      .optional()
      .openapi({ description: "A patch of a missing document does nothing." }),
    deletes: z.array(DocId).max(BATCH_MAX).optional(),
    upsertIf: Condition.optional(),
    patchIf: Condition.optional(),
    deleteIf: Condition.optional(),
    deleteBy: Filter.optional().openapi({ description: "Deletes every document that passes." }),
    patchBy: z
      .object({ filter: Filter, attributes: Changes })
      .optional()
      .openapi({ description: "Patches every document that passes." }),
    returnAffectedIds,
  })
  .openapi("Write", {
    description:
      "One change, in this order: `deleteBy`, `patchBy`, `upserts`, `patches`, `deletes`. " +
      "Its conditions see exactly the documents it replaces: if another write lands first, " +
      "it is worked out again.",
  });
export type Write = z.output<typeof Write>;

export const WriteCounts = z
  .object({
    upserted: z.number().int(),
    patched: z.number().int(),
    deleted: z.number().int().openapi({
      description: "Only ids that were there count.",
    }),
    upserted_ids: affectedIds("the ids upserted"),
    patched_ids: affectedIds("the ids patched"),
    deleted_ids: affectedIds("the ids deleted, as `deleted` counts them"),
    billing: Billing,
  })
  .openapi("WriteCounts");

export const DocumentPage = z
  .object({
    documents: z.array(Document.required({ attributes: true })),
    next: z.string().nullable().openapi({
      description: "Pass as `cursor` for the next page. Null on the last page.",
    }),
  })
  .openapi("DocumentPage");

export const ScanQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SCAN_MAX)
    .optional()
    .openapi({ description: `The most documents to return, at most ${SCAN_MAX}. 100 by default.` }),
  cursor: z
    .string()
    .max(1024)
    .optional()
    .openapi({ description: "The `next` of the page before." }),
});
