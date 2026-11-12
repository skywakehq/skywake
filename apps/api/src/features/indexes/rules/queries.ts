import type { indexes } from "@skywake/contract";
import type {
  IndexAggregate,
  IndexHybrid,
  IndexOrder,
  IndexQuery,
  IndexRank,
  IndexRequest,
  IndexSearch,
} from "@skywake/engine";

import { invalidAt } from "../../../http/errors.ts";
import type { Texts } from "../embeddings.ts";
import { vector } from "./documents.ts";
import { optionalFilter } from "./filters.ts";
import {
  at,
  isList,
  isObject,
  kindsOf,
  plainKind,
  scoredOnly,
  under,
  type Kind,
  type Schema,
} from "./kinds.ts";
import { score } from "./scores.ts";

/** The query as the engine takes it. A text vector goes to `texts`. */
export function query(schema: Schema, body: indexes.Query, texts: Texts, path = ""): IndexQuery {
  const here = under(path);
  const column = schema.vectors.find((c) => c.name === body.vector.column);
  if (!column) {
    throw invalidAt(here("vector.column"), `no vector column \`${body.vector.column}\``);
  }
  const value = vector(column, body.vector.value, here("vector.value"), texts);
  const kinds = kindsOf(schema);
  return {
    column: column.name,
    vector: value,
    topK: body.topK,
    recall: body.recall,
    probe: body.probe,
    filter: optionalFilter(kinds, body.filter, here("filter"), "vector"),
    include: included(kinds, body, here),
    offset: body.offset,
    per: per(kinds, body.per, here("per")),
  };
}

/** The text search as the engine takes it. */
export function search(schema: Schema, body: indexes.Search, path = ""): IndexSearch {
  const here = under(path);
  const kinds = kindsOf(schema);
  const texts = schema.attributes.filter((c) => c.type === "text").map((c) => c.name);
  if (texts.length === 0) throw invalidAt(here("query"), "the index has no text attribute");
  const isText = (name: string, where: string) => {
    if (kinds.get(name) !== "text") throw invalidAt(where, `no text attribute \`${name}\``);
  };
  body.fields?.forEach((name, i) => isText(name, at(here("fields"), i)));
  const fields = body.fields ?? texts;
  for (const name of Object.keys(body.boosts ?? {})) {
    if (!fields.includes(name)) throw invalidAt(at(here("boosts"), name), "is not searched");
  }
  body.highlight?.forEach((name, i) => isText(name, at(here("highlight"), i)));
  return {
    query: body.query,
    fields,
    boosts: body.boosts,
    topK: body.topK,
    k1: body.k1,
    b: body.b,
    filter: optionalFilter(kinds, body.filter, here("filter"), "text"),
    include: included(kinds, body, here),
    highlight: body.highlight,
    fuzzy: body.fuzzy,
    lastAsPrefix: body.lastAsPrefix,
    offset: body.offset,
    per: per(kinds, body.per, here("per")),
  };
}

/** The hybrid query as the engine takes it. Text vectors go to `texts`. */
export function hybrid(schema: Schema, body: indexes.Hybrid, texts: Texts, base = ""): IndexHybrid {
  const here = under(base);
  const searches = Object.entries(body.searches).map(([name, one]) => {
    const path = at(here("searches"), name);
    if (one.rerank) throw invalidAt(at(path, "rerank"), "rerank the fused hits instead");
    if (one.consistency) throw invalidAt(at(path, "consistency"), "set it on the hybrid instead");
    return "vector" in one
      ? { name, vector: query(schema, one, texts, path) }
      : { name, text: search(schema, one, path) };
  });
  for (const name of Object.keys(body.fuse.weights ?? {})) {
    if (!(name in body.searches)) {
      throw invalidAt(at(here("fuse.weights"), name), "names no search");
    }
  }
  const { topK, offset } = body;
  const kinds = kindsOf(schema);
  const names = Object.keys(body.searches);
  return {
    searches,
    topK,
    offset,
    per: per(kinds, body.per, here("per")),
    rank: body.rank === undefined ? undefined : score(kinds, names, body.rank, here("rank")),
    k: body.fuse.k,
    weights: body.fuse.weights,
  };
}

/** The order as the engine takes it. */
export function order(schema: Schema, body: indexes.Order, path = ""): IndexOrder {
  const here = under(path);
  const kinds = kindsOf(schema);
  const orderable = (name: string, path: string) => {
    const kind = plainKind(kinds, name);
    if (name !== "id" && (!kind || isList(kind) || scoredOnly(kind) || kind === "text")) {
      throw invalidAt(path, "takes `id` or an attribute that is not a list or text");
    }
  };
  orderable(body.by, here("by"));
  body.thenBy?.forEach((key, i) => orderable(key.by, at(at(here("thenBy"), i), "by")));
  const { by, descending, thenBy, missingLowest, topK, offset } = body;
  return {
    by,
    descending,
    thenBy,
    missingLowest,
    topK,
    offset,
    include: included(kinds, body, here),
    filter: optionalFilter(kinds, body.filter, here("filter"), "vector"),
  };
}

/** The rank as the engine takes it. */
export function rank(schema: Schema, body: indexes.Rank, path = ""): IndexRank {
  const here = under(path);
  const kinds = kindsOf(schema);
  const { topK, offset } = body;
  return {
    score: score(kinds, [], body.score, here("score")),
    topK,
    offset,
    include: included(kinds, body, here),
    filter: optionalFilter(kinds, body.filter, here("filter"), "vector"),
  };
}

/** The aggregation as the engine takes it. */
export function aggregate(schema: Schema, body: indexes.Aggregate, path = ""): IndexAggregate {
  const here = under(path);
  const kinds = kindsOf(schema);
  body.groupBy?.forEach((name, i) => {
    const kind = plainKind(kinds, name);
    const each = body.each?.includes(name) ?? false;
    if (!kind || (isList(kind) && !each) || kind === "text" || scoredOnly(kind)) {
      throw invalidAt(at(here("groupBy"), i), "takes an attribute that is not a list or text");
    }
  });
  body.each?.forEach((name, i) => {
    const kind = plainKind(kinds, name);
    if (!body.groupBy?.includes(name) || !kind || !isList(kind)) {
      throw invalidAt(at(here("each"), i), "takes a list attribute that is in groupBy");
    }
  });
  for (const [name, [measure, of]] of Object.entries(body.measures)) {
    const field = at(here("measures"), name);
    if (of === undefined) continue;
    const kind = plainKind(kinds, of);
    if (!kind) throw invalidAt(field, `no attribute \`${of}\``);
    const numeric = kind === "int" || kind === "number";
    const ordered = !isList(kind) && !scoredOnly(kind) && kind !== "text" && kind !== "bool";
    if ((measure === "sum" || measure === "avg") && !numeric) {
      throw invalidAt(field, `${measure} takes an int or number attribute`);
    }
    if ((measure === "min" || measure === "max") && !ordered) {
      throw invalidAt(field, `${measure} takes an attribute that is not a list, text or bool`);
    }
  }
  return {
    groupBy: body.groupBy,
    each: body.each,
    measures: body.measures,
    filter: optionalFilter(kinds, body.filter, here("filter"), "vector"),
  };
}

/** The requests of a multi-query as the engine takes them. */
export function multi(schema: Schema, body: indexes.Multi, texts: Texts): IndexRequest[] {
  return body.requests.map((request, i) => {
    const path = at("requests", i);
    const [kind, inner] = Object.entries(request)[0]!;
    if (isObject(inner) && inner.rerank !== undefined) {
      throw invalidAt(
        at(at(path, kind), "rerank"),
        "rerank works in its own request, not in multi",
      );
    }
    if (isObject(inner) && inner.consistency !== undefined) {
      throw invalidAt(at(at(path, kind), "consistency"), "set it on the multi instead");
    }
    if ("query" in request)
      return { query: query(schema, request.query, texts, at(path, "query")) };
    if ("search" in request) return { search: search(schema, request.search, at(path, "search")) };
    if ("hybrid" in request)
      return { hybrid: hybrid(schema, request.hybrid, texts, at(path, "hybrid")) };
    if ("order" in request) return { order: order(schema, request.order, at(path, "order")) };
    if ("rank" in request) return { rank: rank(schema, request.rank, at(path, "rank")) };
    return { aggregate: aggregate(schema, request.aggregate, at(path, "aggregate")) };
  });
}

/** Checks `rerank`. `text` is what it ranks by when it names no `query`. */
export function rerank(schema: Schema, body: indexes.Rerank, text: string | undefined) {
  const kind = schema.attributes.find((c) => c.name === body.field)?.type;
  if (kind !== "string" && kind !== "text") {
    throw invalidAt("rerank.field", `no string or text attribute \`${body.field}\``);
  }
  const query = body.query ?? text;
  if (query === undefined) throw invalidAt("rerank.query", "is needed to rank by");
  return { ...body, query };
}

/** The attributes to return: `include`, or every one but `exclude`. */
function included(
  kinds: Map<string, Kind>,
  body: { include?: string[]; exclude?: string[] },
  here: (key: string) => string,
): string[] | undefined {
  const known = (key: "include" | "exclude") =>
    body[key]?.forEach((name, i) => {
      if (!kinds.has(name)) throw invalidAt(at(here(key), i), `no attribute \`${name}\``);
    });
  known("include");
  known("exclude");
  if (body.exclude === undefined) return body.include;
  if (body.include !== undefined) throw invalidAt(here("exclude"), "give `include` or `exclude`");
  return [...kinds.keys()].filter((name) => !body.exclude!.includes(name));
}

function per(kinds: Map<string, Kind>, body: indexes.Per | undefined, path: string) {
  body?.attributes.forEach((name, i) => {
    if (!kinds.has(name))
      throw invalidAt(at(at(path, "attributes"), i), `no attribute \`${name}\``);
  });
  return body;
}
