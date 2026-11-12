import type { indexes } from "@skywake/contract";

import { invalidAt } from "../../http/errors.ts";
import { kindsOf } from "../indexes/rules/kinds.ts";
import { FILTER_OPS, filterOf } from "./filters.ts";
import { isVectorKey, vectorName } from "./schema.ts";
import { decodeVector } from "./vectors.ts";

type Schema = indexes.IndexSchema;
type Body = Record<string, unknown>;
type Score = NonNullable<indexes.Hybrid["rank"]>;
type Kinds = ReturnType<typeof kindsOf>;

export type Plan =
  | { kind: "query"; body: indexes.Query }
  | { kind: "search"; body: indexes.Search; highlights: Record<string, string> }
  | { kind: "hybrid"; body: indexes.Hybrid }
  | { kind: "rank"; body: indexes.Rank }
  | { kind: "order"; body: indexes.Order }
  | { kind: "aggregate"; body: indexes.Aggregate; grouped: boolean; keys: Record<string, string> };

const DEPTH = 1000;
const OPERATORS = new Set(["Sum", "Max", "Product", "Attribute", "Saturate", "Decay", "Dist"]);
const ORDER_KEYS_MAX = 8;

export function planOf(schema: Schema, q: Body, path: string): Plan {
  const kinds = kindsOf(schema);
  const filter =
    q.filters === undefined || q.filters === null
      ? undefined
      : filterOf(q.filters, `${path}filters`, kinds);
  if (q.aggregate_by !== undefined) return aggregation(q, filter, path);
  const rank = q.rank_by;
  if (!Array.isArray(rank)) throw invalidAt(`${path}rank_by`, "is needed without aggregate_by");
  const { topK, per } = limitOf(q, path);
  const offset = q.offset as number | undefined;
  const shown = shownOf(schema, q);
  const common = { topK, offset, filter, per, ...shown };
  const at = `${path}rank_by`;

  if (Array.isArray(rank[0]) || rank[1] === "asc" || rank[1] === "desc") {
    return ordering(rank, at, { topK, offset, filter, ...shown });
  }
  const [named, op, value, options] = rank as [string, string, unknown, Body | undefined];
  if (op === "ANN" || op === "kNN") {
    const column = vectorName(schema, named);
    if (Array.isArray(value) && Array.isArray(value[0])) {
      const score = { max_sim: { attribute: column, vectors: value } };
      return { kind: "rank", body: { score, topK, offset, filter, ...shown } };
    }
    const vector = embedded(value) ?? decodeVector(value, `${at}[2]`);
    const exact = op === "kNN" ? { recall: 1 } : {};
    return { kind: "query", body: { vector: { column, value: vector }, ...exact, ...common } };
  }
  if (op === "SparseKNN") {
    const entries = Object.entries(value as Record<string, number>);
    const dot = {
      attribute: named,
      indices: entries.map(([d]) => Number(d)),
      values: entries.map(([, w]) => w),
    };
    return { kind: "rank", body: { score: { dot }, topK, offset, filter, ...shown } };
  }
  if (op === "BM25") {
    const highlights = highlightsOf(q);
    const search = {
      query: words(value),
      fields: [named],
      ...common,
      highlight: [...new Set(Object.values(highlights))],
      ...(options?.last_as_prefix === true ? { lastAsPrefix: true } : {}),
    };
    return { kind: "search", body: search as indexes.Search, highlights };
  }
  const leaves: Leaf[] = [];
  const score = scoreOf(rank, leaves, kinds, at);
  if (leaves.length === 0) {
    return { kind: "rank", body: { score, topK, offset, filter, ...shown } };
  }
  const searches = Object.fromEntries(
    leaves.map((leaf, i) => [
      `s${i}`,
      {
        query: leaf.query,
        fields: [leaf.field],
        topK: DEPTH,
        filter,
        ...shown,
        ...(leaf.prefix ? { lastAsPrefix: true } : {}),
      },
    ]),
  );
  return {
    kind: "hybrid",
    body: { searches, topK, offset, per, rank: score, fuse: { k: 60 } } as indexes.Hybrid,
  };
}

type Ordered = Pick<indexes.Order, "topK" | "offset" | "filter" | "include" | "exclude">;

function ordering(rank: unknown[], at: string, rest: Ordered): Plan {
  const keys = (Array.isArray(rank[0]) ? rank : [rank]) as [string, string][];
  if (keys.length === 0 || keys.length > ORDER_KEYS_MAX) {
    throw invalidAt(at, `orders by 1 to ${ORDER_KEYS_MAX} attributes`);
  }
  const [first, ...more] = keys.map(([by, direction], i) => {
    if (direction !== "asc" && direction !== "desc") {
      throw invalidAt(`${at}[${i}]`, 'is [attribute, "asc" | "desc"]');
    }
    return { by, descending: direction === "desc" };
  });
  return {
    kind: "order",
    body: {
      ...first!,
      ...(more.length > 0 ? { thenBy: more } : {}),
      missingLowest: true,
      ...rest,
    } as indexes.Order,
  };
}

interface Leaf {
  field: string;
  query: string;
  prefix: boolean;
}

function scoreOf(node: unknown, leaves: Leaf[], kinds: Kinds, path: string): Score {
  if (typeof node === "number") return node;
  if (!Array.isArray(node)) throw invalidAt(path, "is not a ranking expression");
  const [head, a, b, c] = node as [unknown, unknown, unknown, unknown];
  if (typeof head === "string" && !OPERATORS.has(head) && a === "BM25") {
    const prefix = (c as Body | undefined)?.last_as_prefix === true;
    leaves.push({ field: head, query: words(b), prefix });
    return { search: `s${leaves.length - 1}` };
  }
  if (isFilter(node)) return { filter: filterOf(node, path, kinds) };
  switch (head) {
    case "Sum":
    case "Max": {
      if (!Array.isArray(a) || a.length === 0) throw invalidAt(path, `${head} takes a list`);
      const list = a.map((item, i) => scoreOf(item, leaves, kinds, `${path}[1][${i}]`));
      return head === "Sum" ? { sum: list } : { max: list };
    }
    case "Product": {
      const [weight, of] = typeof a === "number" ? [a, b] : [b, a];
      if (typeof weight !== "number") throw invalidAt(path, "Product takes a number and a score");
      return { product: [weight, scoreOf(of, leaves, kinds, path)] };
    }
    case "Attribute":
      return { attribute: a as string };
    case "Dist": {
      const origin = instantOf(b, `${path}[2]`);
      return { dist: { of: scoreOf(a, leaves, kinds, `${path}[1]`), origin } };
    }
    case "Saturate":
    case "Decay": {
      const { midpoint, exponent = 1 } = (b ?? {}) as { midpoint?: unknown; exponent?: number };
      const m = spanOf(midpoint, `${path}[2].midpoint`);
      if (typeof exponent !== "number" || !(exponent > 0)) {
        throw invalidAt(`${path}[2].exponent`, "is a number above 0");
      }
      const inner = scoreOf(a, leaves, kinds, `${path}[1]`);
      const of = exponent === 1 ? inner : { pow: { of: inner, exponent } };
      const saturate = { saturate: { of, k: m ** exponent } };
      return head === "Saturate" ? saturate : { sum: [1, { product: [-1, saturate] }] };
    }
  }
  throw invalidAt(path, "is not a ranking expression");
}

function isFilter(node: unknown[]): boolean {
  const [head, op] = node;
  if (head === "And" || head === "Or" || head === "Not") return true;
  return typeof head === "string" && typeof op === "string" && FILTER_OPS.has(op);
}

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function spanOf(value: unknown, path: string): number {
  if (typeof value === "number" && value > 0) return value;
  const found = typeof value === "string" ? /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(value) : null;
  if (found) return Number(found[1]) * UNITS[found[2]!]!;
  throw invalidAt(path, 'is a number above 0 or a duration such as "6h"');
}

function instantOf(value: unknown, path: string): number {
  if (typeof value === "number") return value;
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw invalidAt(path, "is a number or a date and time");
  return ms;
}

function aggregation(q: Body, filter: Record<string, unknown> | undefined, path: string): Plan {
  const measures: indexes.Aggregate["measures"] = {};
  for (const [label, spec] of Object.entries(q.aggregate_by as Record<string, unknown[]>)) {
    const [op, of] = spec as [string, string | undefined];
    if (op === "Count") measures[label] = of === undefined ? ["count"] : ["count", of];
    else if (op === "Sum" && of) measures[label] = ["sum", of];
    else {
      throw invalidAt(
        `${path}aggregate_by.${label}`,
        'takes ["Count"], ["Count", attribute] or ["Sum", attribute]',
      );
    }
  }
  const groupBy: string[] = [];
  const each: string[] = [];
  const keys: Record<string, string> = {};
  const groups = (q.group_by as unknown[] | undefined) ?? [];
  groups.forEach((group, i) => {
    if (typeof group === "string") {
      groupBy.push(group);
      keys[group] = group;
      return;
    }
    const [as, spec] = Object.entries((group ?? {}) as Record<string, unknown>)[0] ?? [];
    const [op, of] = (Array.isArray(spec) ? spec : []) as [unknown, unknown];
    if (op !== "ForEachUnique" || typeof of !== "string" || typeof as !== "string") {
      throw invalidAt(
        `${path}group_by[${i}]`,
        'is an attribute or {key: ["ForEachUnique", attribute]}',
      );
    }
    groupBy.push(of);
    each.push(of);
    keys[of] = as;
  });
  const grouped = groupBy.length > 0;
  return {
    kind: "aggregate",
    body: {
      measures,
      filter,
      ...(grouped ? { groupBy } : {}),
      ...(each.length > 0 ? { each } : {}),
    } as indexes.Aggregate,
    grouped,
    keys,
  };
}

function limitOf(q: Body, path: string) {
  const limit = q.limit as number | { total?: number; per?: indexes.Per } | undefined;
  const total = typeof limit === "number" ? limit : limit?.total;
  const topK = (q.top_k as number | undefined) ?? total ?? 10;
  if (!Number.isInteger(topK) || topK < 1) {
    throw invalidAt(`${path}top_k`, "is a whole number from 1");
  }
  return { topK, per: typeof limit === "object" ? limit.per : undefined };
}

function shownOf(schema: Schema, q: Body): { include?: string[]; exclude?: string[] } {
  const known = new Set(kindsOf(schema).keys());
  const include = q.include_attributes;
  if (include === true) return { exclude: [] };
  if (Array.isArray(include)) {
    return {
      include: include.filter((name: string) => name !== "id" && !isVectorKey(schema, name)),
    };
  }
  if (Array.isArray(q.exclude_attributes)) {
    return { exclude: (q.exclude_attributes as string[]).filter((name) => known.has(name)) };
  }
  return {};
}

function highlightsOf(q: Body): Record<string, string> {
  const shown: Record<string, string> = {};
  for (const [name, expr] of Object.entries((q.compute_attributes ?? {}) as Body)) {
    if (Array.isArray(expr) && expr[0] === "Highlight" && typeof expr[1] === "string") {
      shown[name] = expr[1];
    }
  }
  return shown;
}

function embedded(value: unknown): string | undefined {
  if (Array.isArray(value) && value[0] === "Embed" && typeof value[1] === "string") return value[1];
  return undefined;
}

export const words = (value: unknown) => (Array.isArray(value) ? value.join(" ") : String(value));
