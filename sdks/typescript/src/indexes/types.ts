import type { Schemas } from "../core/api.js";

export type Document = Schemas["Document"];
export type DocId = Schemas["DocId"];
export type IndexQuery = Schemas["Query"];
export type IndexSearch = Schemas["Search"];
export type IndexHybrid = Schemas["Hybrid"];
export type Rerank = Schemas["Rerank"];
export type DocumentPage = Schemas["DocumentPage"];
export type IndexWrite = Schemas["Write"];
export type WriteCounts = Schemas["WriteCounts"];
export type IndexFilter = Schemas["Filter"];
export type IndexOrder = Schemas["Order"];
export type IndexRank = Schemas["Rank"];
export type Ranked = Schemas["Ranked"];
export type IndexAggregate = Schemas["Aggregate"];
export type IndexMulti = Schemas["Multi"];
export type Row = Schemas["Row"];
export type Group = Schemas["Group"];
export type Patch = NonNullable<IndexWrite["patches"]>[number];
export type Performance = Schemas["Performance"];
export type Consistency = Schemas["Consistency"];
export type Billing = Schemas["Billing"];
export type Operation = Schemas["Operation"];
export type IndexVersion = Schemas["IndexVersion"];
export type IndexPinned = Schemas["IndexPinned"];
export type IndexPinning = Schemas["IndexPinning"];

/**
 * What a read returns, with how long it took and where its reads came from in
 * `performance`, and what it counted toward the bill in `billing`. Lists and
 * JSON leave both out.
 */
export type Measured<T> = T[] & {
  readonly performance: Performance;
  readonly billing: Billing;
};

/**
 * Where a new index goes, how many shards it has, the key that encrypts it, and
 * the servers pinned to it.
 */
export interface NewIndexOptions {
  region?: string;
  shards?: number;
  encryption?: Schemas["IndexEncryption"];
  pinned?: IndexPinned;
  /** When an index with the name exists, return it instead of failing. Its schema is not checked. */
  ifMissing?: boolean;
}

/** One page of documents: at most `limit` (1000 at most), from the `next` of the page before. */
export interface DocumentCursor {
  limit?: number;
  cursor?: string;
}
