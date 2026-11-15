import type { IndexFilter, IndexSearch, IndexSearchHit } from "@skywake/engine";

import { gramsOf } from "./grams.ts";

export const GRAMS = "grams";

interface Planned {
  words: IndexSearch;
  partial: IndexSearch | null;
}

export function planPartial(
  schema: { attributes: { name: string }[] },
  search: IndexSearch,
): Planned {
  const fields = search.fields ?? [];
  const words = fields.filter((field) => field !== GRAMS);
  const grams = schema.attributes.some((column) => column.name === GRAMS);
  if (!grams || !fields.includes(GRAMS) || words.length === 0) {
    return { words: search, partial: null };
  }
  const plain: IndexSearch = {
    ...search,
    fields: words,
    boosts: withoutGrams(search.boosts),
    highlight: search.highlight?.filter((field) => field !== GRAMS),
  };
  const tokens = gramsOf(search.query);
  if (!tokens || search.offset) return { words: plain, partial: null };
  const needs: IndexFilter = { [GRAMS]: { contains_all_tokens: tokens } };
  return {
    words: plain,
    partial: {
      query: tokens,
      fields: [GRAMS],
      topK: search.topK,
      filter: search.filter ? { and: [search.filter, needs] } : needs,
      include: search.include,
      per: search.per,
    },
  };
}

export function planSearch(
  schema: { attributes: { name: string; type: string }[] },
  search: IndexSearch,
): Planned {
  const per = perFile(schema, search.per);
  if (!per || search.per) return planPartial(schema, search);
  const include = search.include ?? [];
  const withPath = include.includes("path") ? include : [...include, "path"];
  return planPartial(schema, { ...search, per, include: withPath });
}

export function merged(words: IndexSearchHit[], partial: IndexSearchHit[], topK: number) {
  const key = (hit: IndexSearchHit) =>
    typeof hit.attributes.path === "string" ? `p:${hit.attributes.path}` : JSON.stringify(hit.id);
  const seen = new Set(words.map(key));
  const more = partial
    .filter((hit) => !seen.has(key(hit)))
    .map((hit) => ({ ...hit, highlights: {} }));
  return [...words, ...more].slice(0, topK);
}

export function perFile(
  schema: { attributes: { name: string; type: string }[] },
  per: IndexSearch["per"],
): IndexSearch["per"] {
  if (per) return per;
  const has = (name: string, type: string) =>
    schema.attributes.some((column) => column.name === name && column.type === type);
  return has("chunk", "number") && has("path", "string")
    ? { attributes: ["path"], limit: 1 }
    : undefined;
}

function withoutGrams(boosts: IndexSearch["boosts"]) {
  if (!boosts) return boosts;
  const { [GRAMS]: _, ...rest } = boosts;
  return rest;
}
