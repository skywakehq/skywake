import type { v2 } from "@skywake/contract";
import type { z } from "@hono/zod-openapi";

import { invalid } from "./errors.ts";
import type { Indexes } from "./indexes.ts";
import { embedColumn, textFields, vectorColumn } from "./rows.ts";

type Query = z.output<typeof v2.indexes.Query>;
type Aggregate = z.output<typeof v2.indexes.Aggregate>;
type Group = z.output<typeof v2.indexes.Group>;
type Filter = Record<string, unknown> | undefined;
type Attributes = Record<string, unknown>;
type Hit = { id: string | number; attributes: Attributes; score?: number; distance?: number };

const DEPTH = 50;

export function filterOf(filter: Filter): Filter {
  if (!filter) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === "and" || key === "or") out[key] = (value as Filter[]).map(filterOf);
    else if (key === "not") out[key] = filterOf(value as Filter);
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      const ops = { ...(value as Record<string, unknown>) };
      if ("contains" in ops) {
        ops.contains_any = [ops.contains];
        delete ops.contains;
      }
      out[key] = ops;
    } else out[key] = { eq: value };
  }
  return out;
}

const shown = (asked: Query) =>
  asked.fields ? { include: asked.fields } : { exclude: [] as string[] };

const hitOf = (hit: Hit, score: number) => ({ id: hit.id, score, ...hit.attributes });

export async function query(index: Indexes, asked: Query) {
  const schema = (await index.index()).schema;
  const branch = index.branch(asked.branch);
  const limit = asked.limit ?? 10;
  const filter = filterOf(asked.filter);
  const fields = shown(asked);
  const v1 = index.scope.v1;
  const mode = asked.mode ?? "auto";

  if (asked.vector) {
    const column = vectorColumn(schema, asked.vector.length);
    if (!column)
      throw invalid(
        `has ${asked.vector.length} numbers; no vector field of the index has that many`,
        "vector",
      );
    const { hits } = await v1.post<{ hits: Hit[] }>(`${branch}/query`, {
      vector: { column: column.name, value: asked.vector },
      topK: limit,
      filter,
      ...fields,
    });
    return hits.map((hit) => hitOf(hit, 1 - (hit.distance ?? 0)));
  }

  if (asked.text) {
    const embed = embedColumn(schema);
    const words = textFields(schema);
    const meaning = embed && mode !== "keywords";
    const keywords = words.length > 0 && mode !== "meaning";
    if (mode === "meaning" && !embed) {
      throw invalid(
        "is `meaning`, but the index has no embedding model",
        "mode",
        "use `keywords`, or make the index with `embed`",
      );
    }
    if (!meaning && !keywords) {
      throw invalid(
        "can't be searched: the index has no text fields",
        "text",
        "pass `vector`, or add a string field",
      );
    }
    const vectorSearch = embed && { vector: { column: embed.name, value: asked.text }, filter };
    const wordSearch = { query: asked.text, fields: words, filter };
    if (meaning && keywords) {
      const { hits } = await v1.post<{ hits: Hit[] }>(`${branch}/hybrid`, {
        searches: {
          meaning: { ...vectorSearch, topK: Math.max(limit, DEPTH), ...fields },
          words: { ...wordSearch, topK: Math.max(limit, DEPTH), ...fields },
        },
        topK: limit,
      });
      return hits.map((hit) => hitOf(hit, hit.score ?? 0));
    }
    if (meaning) {
      const { hits } = await v1.post<{ hits: Hit[] }>(`${branch}/query`, {
        ...vectorSearch,
        topK: limit,
        ...fields,
      });
      return hits.map((hit) => hitOf(hit, 1 - (hit.distance ?? 0)));
    }
    const { hits } = await v1.post<{ hits: Hit[] }>(`${branch}/search`, {
      ...wordSearch,
      topK: limit,
      ...fields,
    });
    return hits.map((hit) => hitOf(hit, hit.score ?? 0));
  }

  const keys = Object.entries(asked.sort ?? { id: "asc" });
  const [first, ...rest] = keys.map(([by, dir]) => ({ by, descending: dir === "desc" }));
  const { rows } = await v1.post<{ rows: Hit[] }>(`${branch}/order`, {
    ...first,
    thenBy: rest.length ? rest : undefined,
    topK: limit,
    filter,
    ...fields,
  });
  return rows.map((row) => hitOf(row, 0));
}

export async function count(index: Indexes, filter: Filter, branch?: string) {
  await index.index();
  const { groups } = await index.scope.v1.post<{ groups: { values: { count: number } }[] }>(
    `${index.branch(branch)}/aggregate`,
    { measures: { count: ["count"] }, filter: filterOf(filter) },
  );
  return groups[0]?.values.count ?? 0;
}

const MEASURES = ["sum", "avg", "min", "max"] as const;
const listOf = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

export async function aggregate(index: Indexes, asked: Aggregate) {
  await index.index();
  const measures: Record<string, string[]> = {};
  if (asked.count !== false) measures.count = ["count"];
  for (const measure of MEASURES) {
    for (const field of listOf(asked[measure])) measures[`${measure}__${field}`] = [measure, field];
  }
  if (Object.keys(measures).length === 0)
    throw invalid(
      "asks for nothing",
      "count",
      "ask for `count`, or a `sum`, `avg`, `min` or `max` of a field",
    );
  const { groups } = await index.scope.v1.post<{
    groups: { key: Attributes; values: Record<string, number> }[];
  }>(`${index.branch(asked.branch)}/aggregate`, {
    measures,
    groupBy: listOf(asked.group_by).length ? listOf(asked.group_by) : undefined,
    filter: filterOf(asked.filter),
  });
  return groups.map((group) => {
    const out: Group = { group: group.key };
    if (measures.count) out.count = group.values.count;
    for (const [name, value] of Object.entries(group.values)) {
      const [measure, field] = name.split("__") as [(typeof MEASURES)[number], string | undefined];
      if (field) out[measure] = { ...out[measure], [field]: value };
    }
    return out;
  });
}
