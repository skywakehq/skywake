import { z } from "../schemas.ts";

export const UsageDay = z
  .object({
    day: z.string().openapi({ description: "The day in UTC, such as `2026-11-08`." }),
    queries: z.number().int(),
    writes: z.number().int().openapi({ description: "Documents written." }),
    deletes: z.number().int().openapi({ description: "Ids deleted." }),
    embeddings: z.number().int().openapi({ description: "Texts embedded." }),
    reranks: z.number().int().openapi({ description: "Queries reranked." }),
    rows: z.number().int().nullable().openapi({
      description: "Live documents of `main` when last counted that day; null if not counted.",
    }),
    bytes: z.number().int().nullable(),
  })
  .openapi("IndexUsageDay");

export const IndexUsage = z
  .object({ days: z.array(UsageDay).openapi({ description: "Oldest first, one per day." }) })
  .openapi("IndexUsage");
