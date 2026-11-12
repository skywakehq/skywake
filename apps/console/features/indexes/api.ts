// The calls the index pages make, through the console's proxy. Indexes are
// not synced by Zero: their counts live in the store, not in Postgres.

import { useCallback, useState } from "react";
import { asJSON, useFetch } from "@/lib/fetch-text";
import { indexApi } from "@/lib/paths";

export type Metric = "cosine" | "euclidean" | "dot";
export type AttributeType = "string" | "number" | "bool" | "strings" | "text";
export type VectorColumn = { name: string; dims: number; metric: Metric };
export type AttributeColumn = { name: string; type: AttributeType; k1?: number; b?: number };
export type Schema = { vectors: VectorColumn[]; attributes: AttributeColumn[] };

export type Stats = {
  rows: number;
  deleted_rows: number;
  segments: number;
  indexed_rows: number;
  unindexed_rows: number;
  clusters: number;
  bytes: number;
};

export type PinnedReplica = { server: string; warm: boolean; in_flight: number };

export type IndexInfo = {
  name: string;
  region: string;
  schema: Schema;
  created: string;
  stats?: Stats | null;
  pinned?: { replicas: number } | null;
  pinning?: { replicas: PinnedReplica[] } | null;
};

export type IndexBranch = { name: string; forked_from: string | null; created: string };
export type DocId = string | number;
export type AttributeValue = string | number | boolean | string[];
export type Hit = { id: DocId; distance: number; attributes: Record<string, AttributeValue> };
/** `marks` are `[start, end)` string indices of the matched words in `text`. */
export type Highlight = { text: string; marks: [number, number][] };
export type SearchHit = {
  id: DocId;
  score: number;
  attributes: Record<string, AttributeValue>;
  highlights: Record<string, Highlight>;
};
export type FusedHit = SearchHit & {
  ranks: Record<string, number>;
  scores: Record<string, number>;
};
export type Document = {
  id: DocId;
  vectors: Record<string, number[]>;
  attributes: Record<string, AttributeValue>;
};
export type DocumentPage = { documents: Document[]; next: string | null };
export type UsageDay = {
  day: string;
  queries: number;
  writes: number;
  deletes: number;
  rows: number | null;
  bytes: number | null;
};

/** An API error, with the JSON path of the field that is wrong if there is one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly path?: string,
  ) {
    super(message);
  }
}

/** Sends one call and gives its JSON, or throws the API's message. */
export async function call<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(data?.error ?? response.statusText, data?.path);
  return data as T;
}

/** A GET through the proxy, and a way to ask again after a change. */
export function useApi<T>(url: string | null) {
  const [round, setRound] = useState(0);
  // A new fragment makes a new request without changing what the API sees.
  const loaded = useFetch<T>(url && `${url}#${round}`, asJSON);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { loaded, reload };
}

export const indexUrl = (index: string) => indexApi(index);
export const branchUrl = (index: string, branch: string, rest = "") =>
  indexApi(index, `branches/${encodeURIComponent(branch)}${rest ? `/${rest}` : ""}`);

export function bytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i ? n.toFixed(1) : n} ${units[i]}`;
}
