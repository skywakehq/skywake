import type { DocId } from "@skywake/engine";

import type { SearchIndex } from "../../auth/access.ts";
import type { Ctx } from "../../http/context.ts";
import { invalidAt } from "../../http/errors.ts";
import type { Plan } from "./rank.ts";
import { isVectorKey, ourName } from "./schema.ts";

type Body = Record<string, unknown>;
type Row = { id: DocId } & Record<string, unknown>;
type Run = (q: Body) => Promise<Row[]>;
type Bill = {
  count(what: "embeddings", n: number): void;
  admit(what: "embeddings"): Promise<void>;
};

export async function computed(
  c: Ctx,
  index: SearchIndex,
  branch: string,
  q: Body,
  plan: Plan,
  rows: Row[],
  run: Run,
  bill: Bill,
) {
  if (rows.length === 0) return;
  await withVectors(index, branch, q, rows);
  const near = (expr: unknown) => ({
    rank_by: expr,
    filters: ["id", "In", rows.map((row) => row.id)],
    top_k: rows.length,
  });
  const set = (as: string, found: Row[], value: (row: Row | undefined) => unknown) => {
    const byId = new Map(found.map((row) => [row.id, row]));
    for (const row of rows) row[as] = value(byId.get(row.id));
  };
  for (const [as, expr] of Object.entries((q.compute_attributes ?? {}) as Body)) {
    const path = `compute_attributes.${as}`;
    if (!Array.isArray(expr)) throw invalidAt(path, "is an expression");
    if (expr[0] === "Highlight") {
      if (plan.kind === "search" && plan.highlights[as]) continue;
      const words = wordsFor(expr, q.rank_by);
      if (words === undefined) {
        for (const row of rows) row[as] = [];
        continue;
      }
      const found = await run({
        ...near([expr[1], "BM25", words]),
        compute_attributes: { [as]: expr },
      });
      set(as, found, (row) => row?.[as] ?? []);
    } else if (expr[0] === "Embed") {
      await bill.admit("embeddings");
      const vector = await embedded(c, index, expr, path);
      bill.count("embeddings", 1);
      for (const row of rows) row[as] = vector;
    } else if (expr[1] === "VectorDist") {
      const found = await run(near([expr[0], "kNN", expr[2]]));
      set(as, found, (row) => row?.$dist ?? null);
    } else {
      const found = await run(near(expr));
      set(as, found, (row) => row?.$dist ?? 0);
    }
  }
}

async function withVectors(index: SearchIndex, branch: string, q: Body, rows: Row[]) {
  const include = q.include_attributes;
  const names =
    include === true
      ? index.schema.vectors.map((column) => column.name)
      : Array.isArray(include)
        ? (include as string[]).filter((name) => isVectorKey(index.schema, name)).map(ourName)
        : [];
  if (names.length === 0) return;
  const docs = await index.store.getMany(
    branch,
    rows.map((row) => row.id),
  );
  const byId = new Map(docs.map((doc) => [doc.id, doc.vectors as Record<string, unknown>]));
  for (const row of rows) {
    const vectors = byId.get(row.id) ?? {};
    for (const name of names) row[name] = vectors[name] ?? null;
  }
}

function wordsFor(expr: unknown[], rank: unknown): string | undefined {
  const config = (expr[2] ?? {}) as { rank_fragments_by?: unknown };
  const own = bm25(config.rank_fragments_by);
  if (own !== undefined) return own;
  return bm25(rank, expr[1] as string);
}

function bm25(node: unknown, field?: string): string | undefined {
  if (!Array.isArray(node)) return undefined;
  if (node[1] === "BM25" && (field === undefined || node[0] === field || node[0] === "$fragment")) {
    return Array.isArray(node[2]) ? node[2].join(" ") : String(node[2]);
  }
  for (const inner of node.flat()) {
    const found = bm25(inner, field);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function embedded(c: Ctx, index: SearchIndex, expr: unknown[], path: string) {
  if (typeof expr[1] !== "string") throw invalidAt(path, '["Embed", text] takes text');
  const asked = (expr[2] as { model?: string } | undefined)?.model;
  const models = [...new Set(index.schema.vectors.flatMap((c) => c.embed?.model ?? []))];
  const model = asked ?? (models.length === 1 ? models[0] : undefined);
  if (!model) throw invalidAt(path, "names no model, and the namespace has not one embed model");
  const dims = index.schema.vectors.find((column) => column.embed?.model === model)?.dims;
  const [vector] = await c.var.services.models.embed(model, [expr[1]], dims);
  return vector;
}
