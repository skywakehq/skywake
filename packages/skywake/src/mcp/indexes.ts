import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Skywake } from "@skywake/sdk";
import { z } from "zod";

import { DESTROY, READ, WRITE, guarded, json } from "./results.ts";

const index = z.string().describe("The index's name.");
const filter = z.record(z.string(), z.unknown()).describe('Such as {"price": {"lt": 100}}.');

export function indexTools(server: McpServer, sky: Skywake, write: boolean) {
  server.registerTool(
    "index_query",
    {
      description:
        "Searches an index. With text, by meaning and keywords together; with neither text nor vector, lists rows.",
      inputSchema: {
        index,
        text: z.string().optional(),
        vector: z.array(z.number()).optional(),
        filter: filter.optional(),
        limit: z.number().int().optional(),
        mode: z.enum(["auto", "meaning", "keywords"]).optional(),
        fields: z.array(z.string()).optional(),
      },
      annotations: READ,
    },
    guarded(async ({ index, ...options }) => json(await sky.index(index).query(options))),
  );

  if (!write) return;

  server.registerTool(
    "index_upsert",
    {
      description:
        "Writes rows; each replaces any row with its id. The first write makes the index.",
      inputSchema: { index, rows: z.array(z.record(z.string(), z.unknown())) },
      annotations: { ...WRITE, idempotentHint: true },
    },
    guarded(async ({ index, rows }) => json(await sky.index(index).upsert(rows))),
  );

  server.registerTool(
    "index_delete",
    {
      description: "Deletes rows by id, or every row a filter matches.",
      inputSchema: {
        index,
        ids: z.array(z.union([z.string(), z.number()])).optional(),
        filter: filter.optional(),
      },
      annotations: DESTROY,
    },
    guarded(async ({ index, ids, filter }) => {
      if (!ids && !filter) throw new Error("pass `ids` or `filter`");
      const deleted = await sky.index(index).delete(ids ?? { filter: filter! });
      return json({ deleted });
    }),
  );
}
