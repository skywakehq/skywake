// The calls the index pages make, through the console's proxy. Indexes are
// not synced by Zero: their counts live in the store, not in Postgres.

import { useCallback, useEffect, useState } from "react";
import { type Loaded, asJSON, useFetch } from "@/lib/fetch-text";
import { indexApi } from "@/lib/paths";

export type Metric = "cosine" | "euclidean" | "dot";
export type AttributeType = "string" | "number" | "bool" | "strings" | "text";
export type Embed = { model: string; from?: string };
export type VectorColumn = { name: string; dims: number; metric: Metric; embed?: Embed };
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

export type IndexSummary = { name: string; region: string; created: string };
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
export type QueryBody = {
  vector: { column: string; value: number[] | string | { image: string } };
  topK: number;
  recall?: number;
  probe?: number;
  filter?: unknown;
  include?: string[];
};

export type SearchBody = {
  query: string;
  topK: number;
  fields?: string[];
  boosts?: Record<string, number>;
  k1?: number;
  b?: number;
  filter?: unknown;
  include?: string[];
  highlight?: string[];
};

export type HybridBody = {
  searches: Record<string, QueryBody | SearchBody>;
  topK: number;
  fuse?: { k?: number; weights?: Record<string, number> };
};

/** Each request the playground makes, by its route. */
export type Request =
  | { route: "query"; body: QueryBody }
  | { route: "search"; body: SearchBody }
  | { route: "hybrid"; body: HybridBody };

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

type Page<T> = { data: T[]; next: string | null };

async function v2Get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message ?? response.statusText);
  return data as T;
}

async function everyPage<T>(url: string): Promise<T[]> {
  const all: T[] = [];
  for (let cursor: string | null | undefined; cursor !== null; ) {
    const page = await v2Get<Page<T>>(
      cursor === undefined ? url : `${url}?cursor=${encodeURIComponent(cursor)}`,
    );
    all.push(...page.data);
    cursor = page.next;
  }
  return all;
}

/** Every item of a v2 list, following its pages, and a way to ask again. */
export function useEveryPage<T>(url: string) {
  const [round, setRound] = useState(0);
  const key = `${url}#${round}`;
  const [result, setResult] = useState<{ key: string; loaded: Loaded<T[]> } | null>(null);
  useEffect(() => {
    let live = true;
    everyPage<T>(url).then(
      (value) => live && setResult({ key, loaded: { state: "done", value } }),
      (error: Error) =>
        live && setResult({ key, loaded: { state: "failed", error: error.message } }),
    );
    return () => {
      live = false;
    };
  }, [url, key]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  const loaded: Loaded<T[]> = result?.key === key ? result.loaded : { state: "loading" };
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
