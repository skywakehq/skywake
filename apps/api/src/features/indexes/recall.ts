import { indexes as routes } from "@skywake/contract";
import type { IndexRequest } from "@skywake/engine";

import type { SearchIndex } from "../../auth/access.ts";
import type { Ctx } from "../../http/context.ts";
import { invalidAt } from "../../http/errors.ts";
import { Texts } from "./embeddings.ts";
import * as rules from "./rules/index.ts";

const SAMPLE_FROM = 1000;

export async function measureRecall(
  c: Ctx,
  index: SearchIndex,
  branch: string,
  body: routes.RecallCheck,
) {
  const column = body.column ?? index.schema.vectors[0]?.name;
  const dims = index.schema.vectors.find((c) => c.name === column)?.dims;
  if (!column || !dims) throw invalidAt("column", "no such vector column");
  const asked = (vector: number[], recall: number | undefined): IndexRequest => {
    const query = {
      vector: { column, value: vector },
      topK: body.topK,
      recall,
      filter: body.filter,
    };
    return { query: rules.query(index.schema, routes.Query.parse(query), new Texts()) };
  };
  asked(new Array<number>(dims).fill(1), body.recall);
  const vectors = await sample(index, branch, column, body.queries);
  await c.var.services.usage.admit(index.org, "queries");
  const requests = vectors.flatMap((vector) => [asked(vector, body.recall), asked(vector, 1)]);
  const { results } = await index.store.multi(branch, requests, { eventual: false });
  c.var.services.usage.count(index.org, index.name, "queries", requests.length);
  let [recall, found, exact] = [0, 0, 0];
  for (let i = 0; i < results.length; i += 2) {
    const hits = new Set(results[i]!.query!.map((hit) => hit.id));
    const truth = results[i + 1]!.query!.map((hit) => hit.id);
    recall += truth.length ? truth.filter((id) => hits.has(id)).length / truth.length : 1;
    [found, exact] = [found + hits.size, exact + truth.length];
  }
  const n = vectors.length;
  return n === 0
    ? { recall: 1, queries: 0, found: 0, exact: 0 }
    : { recall: recall / n, queries: n, found: found / n, exact: exact / n };
}

async function sample(index: SearchIndex, branch: string, column: string, count: number) {
  const docs = await index.store.scan(branch, null, SAMPLE_FROM);
  const vectors = docs.map((doc) => doc.vectors[column]).filter((v) => v !== undefined);
  for (let i = vectors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vectors[i], vectors[j]] = [vectors[j]!, vectors[i]!];
  }
  return vectors.slice(0, count);
}
