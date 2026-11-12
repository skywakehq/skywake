import { Name, Time, z } from "../schemas.ts";
import { ColumnName } from "./fields.ts";
import { DIMS_MAX, RESERVED_NAMES, SHARDS_MAX } from "./limits.ts";
import { embeddingModel } from "./models.ts";
import { Pinned, Pinning } from "./pinning.ts";

export const Metric = z.enum(["cosine", "euclidean", "dot"]).openapi("Metric", {
  description:
    "How vectors are compared. Each is a distance, so smaller is closer: `1 - cos` for " +
    "`cosine`, the squared distance for `euclidean`, the negative dot product for `dot`.",
});

export const AttributeType = z
  .enum([
    "string",
    "number",
    "int",
    "bool",
    "uuid",
    "datetime",
    "strings",
    "ints",
    "numbers",
    "sparse",
    "vectors",
    "text",
  ])
  .openapi("AttributeType", {
    description:
      "`int` is a whole number. `uuid` and `datetime` are written and read as strings; a " +
      "`datetime` is RFC 3339 (or a date, or milliseconds since 1970) and comes back in UTC. " +
      "`strings`, `ints` and `numbers` are lists; a filter holds if it holds for any item. " +
      "`text` is a string searched by BM25: split into words, lowercased and stemmed in its " +
      "`language`. " +
      "`sparse` is `{indices, values}`, as SPLADE writes, and `vectors` a list of vectors of one " +
      "length, as ColBERT writes; both are scored by `rank`, never filtered or ordered by.",
  });

export const TextLanguage = z
  .enum([
    "english",
    "arabic",
    "danish",
    "dutch",
    "finnish",
    "french",
    "german",
    "greek",
    "hungarian",
    "italian",
    "norwegian",
    "portuguese",
    "romanian",
    "russian",
    "spanish",
    "swedish",
    "tamil",
    "turkish",
    "none",
  ])
  .openapi("TextLanguage", {
    description: "The language a `text` attribute is stemmed in; `none` keeps words whole.",
  });

/** Attribute types a filter index can't sort by. */
const UNSORTED: readonly string[] = ["strings", "ints", "numbers", "sparse", "vectors"];

/** Languages with a stopword list. */
const STOPWORDS: readonly string[] = [
  "english",
  "danish",
  "dutch",
  "finnish",
  "french",
  "german",
  "hungarian",
  "italian",
  "norwegian",
  "portuguese",
  "russian",
  "spanish",
  "swedish",
];

export const VectorElement = z.enum(["f32", "f16", "i8"]).openapi("VectorElement", {
  description:
    "How each number of a vector is stored: `f16` takes half the bytes of `f32`, `i8` a " +
    "quarter and takes whole numbers from -128 to 127.",
});

export const VectorColumn = z
  .object({
    name: ColumnName.openapi({ example: "embedding" }),
    dims: z.number().int().min(1).max(DIMS_MAX).openapi({ example: 768 }),
    metric: Metric.default("cosine"),
    element: VectorElement.optional().openapi({ description: "`f32` by default." }),
    embed: z
      .object({
        model: z.string().min(1).max(256).openapi({ example: "text-embedding-3-small" }),
        from: ColumnName.optional().openapi({
          description:
            "A string or text attribute. A document that gives no vector for this column gets " +
            "its vector by embedding that attribute's text.",
          example: "content",
        }),
      })
      .optional()
      .openapi({
        description:
          "Lets documents and queries give text for this vector: the server embeds it with " +
          "`model` on its embedding provider. The model must give `dims` numbers.",
      }),
  })
  .superRefine((column, context) => {
    const known = column.embed && embeddingModel(column.embed.model);
    if (known && !known.sizes.includes(column.dims)) {
      context.addIssue({
        code: "custom",
        message: `model \`${known.id}\` gives ${known.sizes.join(", ")} numbers, not ${column.dims}`,
        path: ["dims"],
      });
    }
  })
  .refine((column) => !(column.element === "i8" && column.metric === "cosine"), {
    message: "an `i8` column takes `euclidean` or `dot`",
    path: ["element"],
  })
  .openapi("VectorColumn");

const TEXT_OPTIONS = [
  "stemming",
  "filterable",
  "case_sensitive",
  "ascii_folding",
  "max_token_length",
  "pre_tokenized",
] as const;

export const AttributeColumn = z
  .object({
    name: ColumnName.refine((name) => !(RESERVED_NAMES as readonly string[]).includes(name), {
      message: "`and`, `or`, `not` and `id` are taken by filters",
    }).openapi({ example: "tag" }),
    type: AttributeType,
    k1: z.number().min(0).max(10).optional().openapi({
      description: "BM25's term saturation for a `text` attribute. 1.2 by default.",
    }),
    b: z.number().min(0).max(1).optional().openapi({
      description: "BM25's length normalization for a `text` attribute. 0.75 by default.",
    }),
    language: TextLanguage.optional().openapi({
      description: "The stemming language of a `text` attribute. `english` by default.",
    }),
    stopwords: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Whether a `text` attribute drops its language's stopwords, such as `the` and `of`. " +
          "False by default, so phrases like `to be or not to be` work.",
      }),
    stemming: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Whether a `text` attribute matches words by their stem, so `running` finds `run`. " +
          "True by default.",
      }),
    filterable: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Whether a `text` attribute also filters, orders and groups by its whole value, like a " +
          "string. False by default.",
      }),
    case_sensitive: z.boolean().optional().openapi({
      description: "Whether a `text` attribute tells `Apple` from `apple`. False by default.",
    }),
    ascii_folding: z.boolean().optional().openapi({
      description: "Whether `café` in a `text` attribute matches `cafe`. False by default.",
    }),
    max_token_length: z.number().int().min(1).max(1024).optional().openapi({
      description: "Longer words in a `text` attribute are left out. 39 by default.",
    }),
    pre_tokenized: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Whether a `text` attribute is a list of strings, each one word as it is, " +
          "not split or changed.",
      }),
    filter_index: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Also keeps the documents sorted by this attribute, so a vector query whose filter " +
          "passes few documents reads just those. For one value, not a list, `sparse` or " +
          "`vectors`. It can be turned on later and is built by the next build.",
      }),
  })
  .refine(
    (column) => column.type === "text" || (column.k1 === undefined && column.b === undefined),
    {
      message: "only a text attribute takes `k1` and `b`",
    },
  )
  .refine(
    (column) =>
      column.type === "text" || (column.language === undefined && column.stopwords === undefined),
    {
      message: "only a text attribute takes `language` and `stopwords`",
    },
  )
  .refine(
    (column) =>
      column.type === "text" || TEXT_OPTIONS.every((option) => column[option] === undefined),
    { message: `only a text attribute takes ${TEXT_OPTIONS.map((o) => `\`${o}\``).join(", ")}` },
  )
  .refine((column) => !column.stopwords || STOPWORDS.includes(column.language ?? "english"), {
    message: "this `language` has no stopword list",
    path: ["stopwords"],
  })
  .refine((column) => !column.filter_index || !UNSORTED.includes(column.type), {
    message: "a filter index takes one value: not a list, `sparse` or `vectors`",
    path: ["filter_index"],
  })
  .openapi("AttributeColumn");

export const IndexSchema = z
  .object({
    vectors: z.array(VectorColumn).max(8).default([]),
    attributes: z.array(AttributeColumn).max(64).default([]),
    id: z
      .enum(["uuid"])
      .optional()
      .openapi({
        description:
          "`uuid` makes every id a UUID, stored in 16 bytes: written as text with or without " +
          "dashes in any case, and returned lowercase with dashes. Unset, an id is a string or a " +
          "whole number. It can't change.",
      }),
  })
  .refine(
    (schema) => schema.vectors.length > 0 || schema.attributes.some((c) => c.type === "text"),
    { message: "an index needs a vector column or a text attribute", path: ["vectors"] },
  )
  .refine(
    (schema) =>
      schema.vectors.every(
        (column) =>
          !column.embed?.from ||
          schema.attributes.some(
            (c) => c.name === column.embed!.from && (c.type === "string" || c.type === "text"),
          ),
      ),
    { message: "`embed.from` names a string or text attribute", path: ["vectors"] },
  )
  .refine((schema) => unique(schema.vectors.map((c) => c.name)), {
    message: "two vector columns have the same name",
    path: ["vectors"],
  })
  .refine((schema) => unique(schema.attributes.map((c) => c.name)), {
    message: "two attributes have the same name",
    path: ["attributes"],
  })
  .openapi("IndexSchema", {
    description:
      "The columns of an index. Attributes can be added later; vector columns can't change.",
  });
export type IndexSchema = z.output<typeof IndexSchema>;

const unique = (names: string[]) => new Set(names).size === names.length;

export const IndexEncryption = z
  .object({
    kms_key_id: z
      .string()
      .min(1)
      .max(2048)
      .openapi({
        description:
          "A key id or ARN in your cloud's key service. Every object of the index is encrypted " +
          "with it; revoking the key there makes the data unreadable.",
      }),
  })
  .openapi("IndexEncryption");

export const Index = z
  .object({
    name: z.string(),
    region: z.string(),
    schema: IndexSchema,
    shards: z.number().int(),
    encryption: IndexEncryption.nullable(),
    read_only: z.boolean().openapi({ description: "Writes are refused while it is true." }),
    retention_days: z
      .number()
      .int()
      .nullable()
      .openapi({
        description:
          "How long a branch's older versions stay to go back to, in days after they were " +
          "replaced. Null keeps every one.",
      }),
    pinned: Pinned.nullable(),
    created: Time,
  })
  .openapi("Index");

export const IndexStats = z
  .object({
    rows: z.number().int().openapi({ description: "Live documents." }),
    deleted_rows: z.number().int(),
    segments: z.number().int().openapi({ description: "Write batches stored." }),
    indexed_rows: z.number().int().openapi({ description: "Rows inside the clusters." }),
    unindexed_rows: z
      .number()
      .int()
      .openapi({ description: "Rows written since the last build, scanned exactly." }),
    clusters: z.number().int(),
    bytes: z.number().int(),
  })
  .openapi("IndexStats");

export const IndexInfo = Index.extend({
  stats: IndexStats.nullable().openapi({
    description: "Of the `main` branch. Null while the server cannot count them.",
  }),
  pinning: Pinning.nullable().openapi({ description: "Where it is pinned; null if it is not." }),
}).openapi("IndexInfo");

export const NewIndex = z
  .object({
    name: Name.openapi({ example: "prod/products" }),
    region: z.string().optional().openapi({
      description: "Where its data lives. It can't change later. The default region if not given.",
    }),
    schema: IndexSchema,
    shards: z
      .number()
      .int()
      .min(1)
      .max(SHARDS_MAX)
      .default(1)
      .openapi({
        description:
          "The parts documents are split over by id, each written and searched in parallel. " +
          "More suits more data and writes; it can't change later.",
      }),
    encryption: IndexEncryption.optional(),
    pinned: Pinned.nullable().optional(),
  })
  .openapi("NewIndex");

export const UpdateIndex = z
  .object({
    read_only: z.boolean().optional(),
    pinned: Pinned.nullable().optional().openapi({ description: "Null unpins the index." }),
    retention_days: z
      .number()
      .int()
      .min(0)
      .max(36500)
      .nullable()
      .optional()
      .openapi({
        description:
          "Days a version stays after it was replaced; `collect` deletes older ones. Null " +
          "keeps every version.",
      }),
    attributes: z
      .array(AttributeColumn)
      .max(64)
      .optional()
      .openapi({
        description:
          "Attributes to add. One the index has must keep its type, but can turn on " +
          "`filter_index`. Documents written before lack the new ones.",
      }),
    drop_attributes: z
      .array(ColumnName)
      .max(64)
      .optional()
      .openapi({
        description:
          "Attributes to take out, with their values. One may come back later only as it was. " +
          "Refused while the index has more than one branch, as they share its data.",
      }),
  })
  .openapi("UpdateIndex");

export const CopyIndex = z
  .object({
    name: Name.openapi({ example: "prod/products-copy" }),
    branch: Name.default("main").openapi({ description: "The branch to copy." }),
    region: z.string().optional().openapi({
      description: "Where the copy's data lives. The source index's region if not given.",
    }),
    encryption: IndexEncryption.optional().openapi({
      description: "The new index's key; none by default.",
    }),
    target_org: z
      .string()
      .optional()
      .openapi({
        description:
          "Another organization to make the new index in. Needs a console token of someone with " +
          "write access in both; an API key belongs to one organization.",
      }),
  })
  .openapi("CopyIndex");
