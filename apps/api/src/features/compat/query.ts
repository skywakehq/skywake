import type { indexes } from "@skywake/contract";
import type { DocId, IndexRequest } from "@skywake/engine";

import type { Ctx } from "../../http/context.ts";
import { badRequest, invalidAt } from "../../http/errors.ts";
import { answer } from "../indexes/answer.ts";
import { Texts } from "../indexes/embeddings.ts";
import { kept, reranked, withField } from "../indexes/rerank.ts";
import * as rules from "../indexes/rules/index.ts";
import { computed } from "./compute.ts";
import { open } from "./names.ts";
import { type Plan, planOf } from "./rank.ts";
import { queryBilling, queryPerformance } from "./wire.ts";

type Body = Record<string, unknown>;
type Schema = indexes.IndexSchema;
type Row = { id: DocId } & Record<string, unknown>;
type Result = { rows?: Row[]; aggregations?: unknown; aggregation_groups?: unknown[] };

const QUERIES_MAX = 16;

export async function query(c: Ctx, name: string, body: Body) {
  const started = performance.now();
  const { index, branch } = await open(c, name, "read");
  const many = Array.isArray(body.queries);
  const asked = (many ? body.queries : [body]) as Body[];
  if (asked.length === 0 || asked.length > QUERIES_MAX) {
    throw invalidAt("queries", `takes 1 to ${QUERIES_MAX} queries`);
  }
  const plans = asked.map((q, i) => planOf(index.schema, q, many ? `queries[${i}].` : ""));
  const rerank = body.rerank_by as Body | unknown[] | undefined;
  const model = rerank && !Array.isArray(rerank) ? rerankPlan(index.schema, rerank) : undefined;
  const texts = new Texts();
  const requests = plans.map((plan) => requestOf(index.schema, plan, texts, model?.field));
  const bill = c.var.services.usage.bill(index);
  await texts.embed(c.var.services.models, bill);
  const level = (body.consistency as { level?: string } | undefined)?.level;
  const consistency = level === "eventual" ? "eventual" : undefined;
  const { results, performance: reads } = await answer(index, branch, requests, consistency, bill);
  const answered = results.map((result, i) =>
    resultOf(plans[i]!, result as unknown as Record<string, unknown>),
  );
  const run = async (q: Body) => {
    const plan = planOf(index.schema, q, "");
    const texts = new Texts();
    const request = requestOf(index.schema, plan, texts);
    await texts.embed(c.var.services.models, bill);
    const { results } = await answer(index, branch, [request], consistency, bill);
    return resultOf(plan, results[0] as unknown as Record<string, unknown>).result.rows ?? [];
  };
  for (const [i, { result }] of answered.entries()) {
    await computed(c, index, branch, asked[i]!, plans[i]!, result.rows ?? [], run, bill);
  }

  let shaped: Result[] = answered.map(({ result }) => result);
  if (rerank) {
    const fused = Array.isArray(rerank)
      ? fusedRows(
          answered.map(({ result }) => result.rows ?? []),
          rerank,
        )
      : await modelRows(c, bill, model!, answered, asked);
    shaped = [{ rows: limited(fused, body) }];
  }
  const rows = shaped.reduce((sum, result) => sum + (result.rows?.length ?? 0), 0);
  const meta = {
    billing: queryBilling(shaped),
    performance: queryPerformance(reads, rows, started),
  };
  return many ? { results: shaped, ...meta } : { ...shaped[0], ...meta };
}

export async function explain(c: Ctx, name: string, body: Body) {
  const { index } = await open(c, name, "read");
  const plan = planOf(index.schema, body, "");
  return { plan_text: `${plan.kind} ${JSON.stringify(plan.body)}` };
}

function requestOf(schema: Schema, plan: Plan, texts: Texts, field?: string): IndexRequest {
  switch (plan.kind) {
    case "query": {
      const query = rules.query(schema, plan.body, texts);
      if (field) query.include = withField(query.include, field);
      return { query };
    }
    case "search": {
      const search = rules.search(schema, plan.body);
      if (field) search.include = withField(search.include, field);
      return { search };
    }
    case "hybrid":
      return { hybrid: rules.hybrid(schema, plan.body, texts) };
    case "rank":
      return { rank: rules.rank(schema, plan.body) };
    case "order":
      return { order: rules.order(schema, plan.body) };
    case "aggregate":
      return { aggregate: rules.aggregate(schema, plan.body) };
  }
}

type Hit = { id: DocId; attributes?: Record<string, unknown>; [key: string]: unknown };

function resultOf(plan: Plan, result: Record<string, unknown>): { result: Result; hits: Hit[] } {
  if (plan.kind === "aggregate") {
    const groups = (result.aggregate ?? []) as { key: Body; values: Body }[];
    if (plan.grouped) {
      return {
        result: {
          aggregation_groups: groups.map((g) => ({
            ...Object.fromEntries(
              Object.entries(g.key).map(([name, value]) => [plan.keys[name] ?? name, value]),
            ),
            ...g.values,
          })),
        },
        hits: [],
      };
    }
    const zero = Object.fromEntries(Object.keys(plan.body.measures).map((label) => [label, 0]));
    return { result: { aggregations: groups[0]?.values ?? zero }, hits: [] };
  }
  const hits = (result[plan.kind] ?? []) as Hit[];
  const dist = (hit: Hit) => (plan.kind === "query" ? hit.distance : hit.score) as number;
  const rows = hits.map((hit) => {
    const row: Row = { id: hit.id };
    if (plan.kind !== "order") row.$dist = dist(hit);
    Object.assign(row, shownAttributes(hit.attributes ?? {}));
    if (plan.kind === "search") {
      const marked = (hit.highlights ?? {}) as Record<string, { text: string }>;
      for (const [as, field] of Object.entries(plan.highlights)) {
        row[as] = marked[field] ? [{ text: marked[field].text }] : [];
      }
    }
    return row;
  });
  return { result: { rows }, hits };
}

function shownAttributes(attributes: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => {
      const sparse = value as { indices?: number[]; values?: number[] } | null;
      if (sparse && typeof sparse === "object" && Array.isArray(sparse.indices)) {
        return [
          key,
          Object.fromEntries(sparse.indices.map((d, i) => [String(d), sparse.values![i]])),
        ];
      }
      return [key, value];
    }),
  );
}

function fusedRows(lists: Row[][], rerank: unknown[]): Row[] {
  if (rerank[0] !== "RRF") throw invalidAt("rerank_by", 'takes ["RRF"] or a model');
  const options = (rerank[1] ?? {}) as { rank_constant?: number; weights?: number[] };
  const k = options.rank_constant ?? 60;
  const fused = new Map<DocId, Row>();
  lists.forEach((rows, list) => {
    const weight = options.weights?.[list] ?? 1;
    rows.forEach((row, i) => {
      const before = fused.get(row.id);
      const score = ((before?.$dist as number | undefined) ?? 0) + weight / (k + i + 1);
      fused.set(row.id, { ...before, ...row, $dist: score });
    });
  });
  return [...fused.values()].sort((a, b) => (b.$dist as number) - (a.$dist as number));
}

function rerankPlan(schema: Schema, rerank: Body) {
  const { model, attribute, query } = rerank as {
    model?: string;
    attribute?: string;
    query?: string;
  };
  if (!model || !attribute) throw invalidAt("rerank_by", "takes a model, attribute and query");
  return rules.rerank(schema, { model, field: attribute, query }, undefined);
}

async function modelRows(
  c: Ctx,
  bill: Parameters<typeof reranked>[1],
  plan: ReturnType<typeof rerankPlan>,
  answered: { hits: Hit[] }[],
  asked: Body[],
): Promise<Row[]> {
  const seen = new Map<DocId, Hit>();
  for (const { hits } of answered)
    for (const hit of hits) if (!seen.has(hit.id)) seen.set(hit.id, hit);
  const hits = [...seen.values()].map((hit) => ({
    ...hit,
    attributes: (hit.attributes ?? {}) as never,
  }));
  const include = asked[0]?.include_attributes;
  const keep =
    include === true || kept({ include: Array.isArray(include) ? include : [] }, plan.field);
  const ordered = await reranked(c.var.services.models, bill, plan, hits, keep);
  return ordered.map((hit) => ({
    id: hit.id,
    $dist: hit.rerank_score,
    ...shownAttributes(hit.attributes),
  }));
}

function limited(rows: Row[], body: Body) {
  const limit = body.limit as number | { total?: number } | undefined;
  const total = typeof limit === "number" ? limit : limit?.total;
  const offset = (body.offset as number | undefined) ?? 0;
  if (offset && total === undefined) throw badRequest("`offset` needs `limit`");
  return rows.slice(offset, total === undefined ? undefined : offset + total);
}
