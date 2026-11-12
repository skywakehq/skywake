import { closed } from "../http.ts";
import { z } from "../schemas.ts";
import { AttributeValue, Billing, DocId } from "./documents.ts";
import { COLUMN, ColumnName, VectorValue } from "./fields.ts";
import { Filter } from "./filters.ts";
import {
  GROUPS_MAX,
  HYBRID_MAX,
  MEASURES,
  MULTI_MAX,
  OFFSET_MAX,
  SEARCH_MAX,
  TOP_K_MAX,
} from "./limits.ts";

export const Rerank = z
  .object({
    model: z.string().min(1).max(256).openapi({ example: "rerank-v3.5" }),
    field: ColumnName.openapi({
      description: "The `string` or `text` attribute whose value is ranked against `query`.",
      example: "body",
    }),
    query: z
      .string()
      .min(1)
      .max(SEARCH_MAX)
      .optional()
      .openapi({
        description:
          "What to rank by. The search's text by default; a vector query needs it unless its " +
          "vector is text.",
      }),
    topN: z.number().int().min(1).max(TOP_K_MAX).optional().openapi({
      description: "The most hits to return after reranking. Every hit by default.",
    }),
  })
  .openapi("Rerank", {
    description:
      "Orders the hits again with a rerank model on the server's rerank provider, best " +
      "first, and gives each a `rerank_score`.",
  });
export type Rerank = z.output<typeof Rerank>;

export const Per = z
  .object({
    attributes: z.array(ColumnName).min(1).max(8),
    limit: z.number().int().min(1).max(TOP_K_MAX),
  })
  .openapi("Per", {
    description:
      "At most `limit` hits for each set of values of `attributes`, such as 3 chunks per " +
      "file. Hits without one of them count together.",
    example: { attributes: ["file"], limit: 3 },
  });

const include = z
  .array(z.string())
  .max(64)
  .optional()
  .openapi({ description: "Attributes to return with each hit. None by default." });

const exclude = z.array(z.string()).max(64).optional().openapi({
  description: "Attributes to leave out: every other one is returned. Not with `include`.",
});

const offset = z.number().int().min(0).max(OFFSET_MAX).optional().openapi({
  description: "Hits to skip before the first returned, for pages. 0 by default.",
});

export type Per = z.output<typeof Per>;
const per = Per.optional();

export const Consistency = z.enum(["strong", "eventual"]).openapi("Consistency", {
  description:
    "`strong` (the default) sees every write that finished before the request. `eventual` " +
    "may use what this server read up to a minute ago, which skips a round trip to object " +
    "storage.",
});
export type Consistency = z.output<typeof Consistency>;
const consistency = Consistency.optional();

export const Performance = z
  .object({
    server_ms: z.number().int().openapi({ description: "Time spent on the server." }),
    cache_temperature: z.enum(["hot", "warm", "cold"]).openapi({
      description:
        "`hot`: everything came from memory; `warm`: some from the disk cache; `cold`: some " +
        "from object storage.",
    }),
    cache_hit_ratio: z
      .number()
      .openapi({ description: "The share of reads a cache served, from 0 to 1." }),
  })
  .openapi("Performance");

const rerankScore = z
  .number()
  .optional()
  .openapi({ description: "With `rerank`, the model's score: larger is better." });

export const Query = z
  .object({
    vector: z.object({ column: ColumnName, value: VectorValue }).openapi({
      description: "`value` may be text when the column has `embed`.",
      example: { column: "embedding", value: [0.1, 0.2, 0.3] },
    }),
    topK: z.number().int().min(1).max(TOP_K_MAX).default(10),
    recall: z
      .number()
      .gt(0)
      .max(1)
      .optional()
      .openapi({
        description:
          "The share of the true nearest `topK` to find, from 0 to 1. The index reads as much " +
          "as its last build measured that takes. 0.95 by default. 1 is an exact search: it " +
          "reads every cluster and returns exactly the true nearest `topK` by the column's " +
          "metric, filtered or not, at the cost of reading the whole index.",
        example: 0.95,
      }),
    probe: z
      .number()
      .int()
      .min(1)
      .optional()
      .openapi({
        description:
          "Clusters to read, instead of what `recall` needs. More is slower and finds more of " +
          "the true nearest.",
      }),
    filter: Filter.optional(),
    include,
    exclude,
    offset,
    per,
    consistency,
    rerank: Rerank.optional(),
  })
  .openapi("Query");
export type Query = z.output<typeof Query>;

export const Hit = z
  .object({
    id: DocId,
    distance: z.number().openapi({ description: "Smaller is closer, for every metric." }),
    attributes: z.record(z.string(), AttributeValue),
    rerank_score: rerankScore,
  })
  .openapi("Hit");

export const Hits = z
  .object({ hits: z.array(Hit), performance: Performance, billing: Billing })
  .openapi("Hits");

export const Search = z
  .object({
    query: z.string().min(1).max(SEARCH_MAX).openapi({ example: "reset password" }),
    fields: z
      .array(ColumnName)
      .min(1)
      .max(64)
      .optional()
      .openapi({ description: "The text attributes to search. Every one by default." }),
    boosts: z
      .record(z.string(), z.number().min(0).max(1000))
      .optional()
      .openapi({ description: "A weight per field; 1 when missing.", example: { title: 2 } }),
    topK: z.number().int().min(1).max(TOP_K_MAX).default(10),
    k1: z.number().min(0).max(10).optional().openapi({
      description: "BM25's term saturation for this query. The first field's by default.",
    }),
    b: z.number().min(0).max(1).optional().openapi({
      description: "BM25's length normalization for this query. The first field's by default.",
    }),
    filter: Filter.optional(),
    include,
    exclude,
    highlight: z.array(z.string()).max(8).optional().openapi({
      description: "Text attributes to return the best fragment of, with the matched words marked.",
    }),
    fuzzy: z
      .number()
      .int()
      .min(0)
      .max(2)
      .optional()
      .openapi({
        description:
          "Also match words within this many edits of each word searched for: a letter " +
          "added, removed or changed, or two swapped. 0 by default.",
      }),
    lastAsPrefix: z.boolean().optional().openapi({
      description:
        "Also match the longer words the query's last word starts, for search as you type.",
    }),
    offset,
    per,
    consistency,
    rerank: Rerank.optional(),
  })
  .openapi("Search");
export type Search = z.output<typeof Search>;

export const Highlight = z
  .object({
    text: z.string().openapi({ description: "About 200 characters around the best match." }),
    marks: z.array(z.tuple([z.number().int(), z.number().int()])).openapi({
      description: "`[start, end)` of each matched word, in UTF-16 code units of `text`.",
    }),
  })
  .openapi("Highlight");

export const SearchHit = z
  .object({
    id: DocId,
    score: z.number().openapi({ description: "BM25: larger is better." }),
    attributes: z.record(z.string(), AttributeValue),
    highlights: z.record(z.string(), Highlight),
    rerank_score: rerankScore,
  })
  .openapi("SearchHit");

export const SearchHits = z
  .object({ hits: z.array(SearchHit), performance: Performance, billing: Billing })
  .openapi("SearchHits");

export const Score = z.union([z.number(), z.record(z.string(), z.unknown())]).openapi("Score", {
  description:
    "An expression that scores each hit, larger is better: a number; " +
    "`{search: <name>}`, that search's score (BM25, or the distance of a vector search; 0 " +
    "when it missed the hit); `{attribute: <name>}`, a number, int, datetime (ms) or bool " +
    "attribute (0 when missing); `{sum | product | max | min: [..]}`; " +
    "`{decay: {of, origin, scale}}`, 1 at `origin` and halving every `scale` away; or " +
    "`{saturate: {of, k}}`, `x / (x + k)`; `{dist: {of, origin}}`, how far `of` is from " +
    "`origin`; `{pow: {of, exponent}}`; `{filter: <filter>}`, 1 when the document passes, " +
    "else 0; " +
    "`{dot: {attribute, indices, values}}`, the dot product with a `sparse` attribute; or " +
    "`{max_sim: {attribute, vectors}}`, for each vector its best dot product with one of a " +
    "`vectors` attribute, summed.",
  example: {
    sum: [
      { search: "title" },
      { search: "body" },
      { saturate: { of: { attribute: "stars" }, k: 3 } },
    ],
  },
});

export const Hybrid = z
  .object({
    searches: z
      .record(z.string().regex(COLUMN), z.union([closed(Query), closed(Search)]))
      .refine((all) => Object.keys(all).length >= 1 && Object.keys(all).length <= HYBRID_MAX, {
        message: `takes 1 to ${HYBRID_MAX} searches`,
      })
      .openapi({
        description:
          "Named searches, each a vector query (with `vector`) or a text search (with " +
          "`query`). Each one's `topK` is how deep it looks.",
        example: {
          meaning: { vector: { column: "embedding", value: [0.1, 0.2, 0.3] }, topK: 50 },
          words: { query: "reset password", topK: 50 },
        },
      }),
    topK: z.number().int().min(1).max(TOP_K_MAX).default(10),
    fuse: z
      .object({
        k: z.number().min(0).max(1000).default(60),
        weights: z.record(z.string(), z.number().min(0).max(1000)).optional(),
      })
      .default({ k: 60 })
      .openapi({
        description:
          "Reciprocal rank fusion: a hit scores the sum of `weight / (k + rank)` over the " +
          "searches that found it, ranks from 1. Weights are 1 when missing.",
      }),
    offset,
    per,
    consistency,
    rank: Score.optional(),
    rerank: Rerank.optional().openapi({
      description:
        "Reranks the fused hits. `query` is the first text search's by default, then the " +
        "first vector given as text.",
    }),
  })
  .openapi("Hybrid", {
    description:
      "`rank` scores the hits the searches found instead of `fuse`; each search's `topK` is " +
      "still how deep it looks.",
  });
export type Hybrid = z.output<typeof Hybrid>;

export const FusedHit = z
  .object({
    id: DocId,
    score: z.number().openapi({ description: "The fused score: larger is better." }),
    ranks: z
      .record(z.string(), z.number().int())
      .openapi({ description: "Its rank in each search that found it, from 1." }),
    scores: z.record(z.string(), z.number()).openapi({
      description: "Its distance in each vector search and BM25 score in each text search.",
    }),
    attributes: z.record(z.string(), AttributeValue),
    highlights: z.record(z.string(), Highlight),
    rerank_score: rerankScore,
  })
  .openapi("FusedHit");

export const FusedHits = z
  .object({ hits: z.array(FusedHit), performance: Performance, billing: Billing })
  .openapi("FusedHits");

export const Order = z
  .object({
    by: z.string().openapi({ description: "An attribute, or `id`.", example: "price" }),
    descending: z.boolean().default(false),
    thenBy: z
      .array(z.object({ by: z.string(), descending: z.boolean().default(false) }))
      .max(7)
      .optional()
      .openapi({ description: "More keys, for ties on the ones before. Up to 8 keys in all." }),
    missingLowest: z
      .boolean()
      .default(false)
      .openapi({
        description:
          "Documents without the attribute sort below every value: first going up, last going " +
          "down. Otherwise they come last either way.",
      }),
    topK: z.number().int().min(1).max(TOP_K_MAX).default(10),
    offset,
    filter: Filter.optional(),
    include,
    exclude,
    consistency,
  })
  .openapi("Order", {
    description: "Documents in the order of one or more attributes; those without one come last.",
  });
export type Order = z.output<typeof Order>;

export const Row = z
  .object({ id: DocId, attributes: z.record(z.string(), AttributeValue) })
  .openapi("Row");

export const Rows = z
  .object({ rows: z.array(Row), performance: Performance, billing: Billing })
  .openapi("Rows");

export const Rank = z
  .object({
    score: Score,
    topK: z.number().int().min(1).max(TOP_K_MAX).default(10),
    offset,
    filter: Filter.optional(),
    include,
    exclude,
    consistency,
  })
  .openapi("Rank", {
    description:
      "Every document that passes the filter, scored exactly, best first. Those scoring 0 are " +
      "left out. Search scores are 0 here.",
    example: { score: { dot: { attribute: "terms", indices: [12, 4071], values: [0.8, 1.3] } } },
  });
export type Rank = z.output<typeof Rank>;

export const Ranked = z
  .object({ id: DocId, score: z.number(), attributes: z.record(z.string(), AttributeValue) })
  .openapi("Ranked");

export const RankedHits = z
  .object({ hits: z.array(Ranked), performance: Performance, billing: Billing })
  .openapi("RankedHits");

export const Aggregate = z
  .object({
    filter: Filter.optional(),
    groupBy: z.array(z.string()).max(8).optional().openapi({
      description: "A group per set of values of these attributes. One group by default.",
    }),
    each: z
      .array(z.string())
      .max(8)
      .optional()
      .openapi({
        description:
          "Lists in `groupBy` that group by each of their items: a document is in one group " +
          "per distinct item, and in none when the list is empty.",
      }),
    measures: z
      .record(
        z.string().regex(COLUMN),
        z.union([z.tuple([z.literal("count")]), z.tuple([z.enum(MEASURES), z.string()])]),
      )
      .refine((all) => Object.keys(all).length >= 1 && Object.keys(all).length <= 16, {
        message: "takes 1 to 16 measures",
      })
      .openapi({
        description:
          'Each by the name it comes back under: `["count"]`, or `["count" | "sum" | "avg" | ' +
          '"min" | "max", attribute]`.',
        example: { total: ["count"], revenue: ["sum", "price"] },
      }),
    consistency,
  })
  .openapi("Aggregate");
export type Aggregate = z.output<typeof Aggregate>;

export const Group = z
  .object({
    key: z.record(z.string(), AttributeValue).openapi({
      description: "The values of `groupBy` its documents share; one they lack is left out.",
    }),
    values: z.record(z.string(), AttributeValue),
  })
  .openapi("Group");

export const Groups = z
  .object({
    groups: z.array(Group).openapi({ description: `In key order, at most ${GROUPS_MAX}.` }),
    performance: Performance,
    billing: Billing,
  })
  .openapi("Groups");

export const Multi = z
  .object({
    requests: z
      .array(
        z.union([
          z.object({ query: closed(Query) }).strict(),
          z.object({ search: closed(Search) }).strict(),
          z.object({ hybrid: closed(Hybrid) }).strict(),
          z.object({ order: closed(Order) }).strict(),
          z.object({ rank: closed(Rank) }).strict(),
          z.object({ aggregate: closed(Aggregate) }).strict(),
        ]),
      )
      .min(1)
      .max(MULTI_MAX),
    consistency: consistency.openapi({
      description: "For every request, which may not set their own.",
    }),
  })
  .openapi("Multi", { description: "Requests that all see the same snapshot of the branch." });
export type Multi = z.output<typeof Multi>;

export const MultiResults = z
  .object({
    results: z.array(
      z
        .object({
          query: z.array(Hit),
          search: z.array(SearchHit),
          hybrid: z.array(FusedHit),
          order: z.array(Row),
          rank: z.array(Ranked),
          aggregate: z.array(Group),
        })
        .partial()
        .openapi({ description: "The answer, in the field the request was asked in." }),
    ),
    performance: Performance,
    billing: Billing,
  })
  .openapi("MultiResults");
