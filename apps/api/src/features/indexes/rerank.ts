import type { AttributeValue } from "@skywake/engine";

import type { Models } from "./models.ts";
import type * as rules from "./rules/index.ts";
import type { Bill } from "./usage.ts";

type Plan = ReturnType<typeof rules.rerank>;

export const withField = (include: string[] | null | undefined, field: string) =>
  include?.includes(field) ? include : [...(include ?? []), field];

export const kept = (body: { include?: string[]; exclude?: string[] }, field: string) =>
  body.include?.includes(field) ?? (body.exclude !== undefined && !body.exclude.includes(field));

export async function reranked<Hit extends { attributes: Record<string, AttributeValue> }>(
  models: Models,
  bill: Bill,
  plan: Plan,
  hits: Hit[],
  keep: boolean,
) {
  const documents = hits.map((hit) => {
    const value = hit.attributes[plan.field];
    return typeof value === "string" ? value : "";
  });
  const topN = Math.min(plan.topN ?? hits.length, hits.length);
  await bill.admit("reranks");
  const ranked =
    hits.length === 0 ? [] : await models.rerank(plan.model, plan.query, documents, topN);
  bill.count("reranks");
  return ranked.slice(0, topN).map(({ index, score }) => {
    const hit = hits[index]!;
    const { [plan.field]: _, ...rest } = hit.attributes;
    return { ...hit, attributes: keep ? hit.attributes : rest, rerank_score: score };
  });
}
