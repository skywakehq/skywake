// Checks documents and queries against an index's schema, so a mistake is
// answered with the JSON path of the field that is wrong.

export { checkIds, documents, write } from "./documents.ts";
export { flatten, isUuid, looksSparse, looksVectors } from "./kinds.ts";
export { aggregate, hybrid, multi, order, query, rank, rerank, search } from "./queries.ts";
