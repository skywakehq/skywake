export type ErrorKind = "not_found" | "conflict" | "invalid" | "unavailable" | "busy" | "internal";

/** What a store holds in its bucket. */
export interface Stored {
  objects: number;
  bytes: number;
}

export declare class EngineError extends Error {
  readonly kind: ErrorKind;
}

/**
 * One change. Give at most one of `content`, `chunks`, `from` or `folder`;
 * with none of them, the path is removed (`null` is refused).
 */
export interface FileEdit {
  path: string;
  /** The new content. */
  content?: Buffer;
  /** A file made of chunks that `storePart` stored, in order. */
  chunks?: FileChunk[];
  /** A copy of another path, without copying data. */
  from?: CopySource;
  /** An empty folder, unless a folder is already there. */
  folder?: boolean;
  executable?: boolean | null;
}

export interface FileChunk {
  hash: string;
  size: number;
}

export interface CopySource {
  path: string;
  /** Copy from this commit. By default, from the branch before this commit. */
  at?: string;
}

export interface FileInfo {
  name: string;
  kind: "file" | "folder" | "symlink";
  size: number;
  executable: boolean;
  target?: string;
  /** Milliseconds since the Unix epoch, for a file. 0 otherwise. */
  modified: number;
}

export interface Listing {
  info: FileInfo;
  entries: FileInfo[];
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  /** Seconds since the Unix epoch. */
  time: number;
  session?: string;
  parent?: string;
  merged?: string;
}

export interface Changed {
  kind: "added" | "removed" | "modified";
  path: string;
}

export interface CommitChanges {
  commit: CommitInfo;
  changes: Changed[];
}

export interface FileVersion {
  commit: CommitInfo;
  /** Missing when the commit removed the file. */
  size?: number;
}

/**
 * What one path becomes in a merge: `take` one side, or new `content` or
 * `chunks`. With none of them, the path is removed. A resolution of a folder
 * settles the conflicts inside it.
 */
export interface MergeResolution {
  path: string;
  take?: "ours" | "theirs";
  content?: Buffer;
  chunks?: FileChunk[];
  executable?: boolean | null;
}

export interface MergeResult {
  head?: string;
  conflicts: string[];
}

type Maybe<T> = T | null | undefined;

/** One store: a local folder or `s3://bucket/folder`. */
export interface Engine {
  createBranch(name: string, from?: Maybe<string>): Promise<string>;
  forkAt(name: string, at: string): Promise<string>;
  deleteBranch(name: string): Promise<void>;
  head(branch: string): Promise<string>;
  branches(): Promise<string[]>;
  /** Every object this store holds, and their bytes, as the bucket bills them. Stops after about `budgetMs` and returns null; the next call carries on where this one stopped. */
  stored(budgetMs: number): Promise<Stored | null>;
  /** A file or folder; of a folder, its entries in name order, `limit` of them after `after` when given, or all of them. */
  list(
    branch: string,
    path: string,
    at?: Maybe<string>,
    after?: Maybe<string>,
    limit?: Maybe<number>,
  ): Promise<Listing>;
  read(
    branch: string,
    path: string,
    offset?: Maybe<number>,
    length?: Maybe<number>,
    at?: Maybe<string>,
  ): Promise<Buffer>;
  search(
    branch: string,
    pattern: string,
    folder?: Maybe<string>,
    limit?: Maybe<number>,
  ): Promise<SearchMatch[]>;
  commitFiles(
    branch: string,
    message: string,
    edits: FileEdit[],
    session?: Maybe<string>,
  ): Promise<string>;
  /** Stores `data` as chunks, for a later edit's `chunks`. */
  storePart(data: Buffer): Promise<FileChunk[]>;
  log(branch: string, limit?: Maybe<number>): Promise<CommitInfo[]>;
  commit(hash: string): Promise<CommitChanges>;
  changesSince(
    branch: string,
    since?: Maybe<string>,
    limit?: Maybe<number>,
  ): Promise<CommitChanges[]>;
  fileHistory(
    branch: string,
    path: string,
    after?: string | undefined | null,
    limit?: number | undefined | null,
  ): Promise<FileVersion[]>;
  diff(from: string, to: string): Promise<Changed[]>;
  /** What changed from one commit to another. */
  diffCommits(from: string, to: string): Promise<Changed[]>;
  /** The newest commit both branches have, or null if they share none. */
  mergeBase(a: string, b: string): Promise<string | null>;
  /** Conflicts that no resolution covers stop the merge, and nothing is saved. */
  merge(
    into: string,
    from: string,
    message: string,
    session?: Maybe<string>,
    resolved?: Maybe<MergeResolution[]>,
  ): Promise<MergeResult>;
  conflicts(into: string, from: string): Promise<string[]>;
}

export interface EngineOpenOptions {
  /**
   * Branch heads are kept by the cache servers in `SKYWAKE_CACHE_NODES`, which
   * serve the whole bucket of this `s3://` location.
   */
  heads?: Maybe<boolean>;
}

export declare const Engine: {
  open(location: string, options?: Maybe<EngineOpenOptions>): Engine;
};

/** A vector column: every document has `dims` numbers in it. */
export interface VectorColumn {
  name: string;
  dims: number;
  metric: "cosine" | "euclidean" | "dot";
  /**
   * How each number is stored: `f32` when unset, `f16` (half the bytes) or
   * `i8` (a quarter; whole numbers from -128 to 127, not with cosine).
   */
  element?: Maybe<"f32" | "f16" | "i8">;
}

export interface AttributeColumn {
  name: string;
  /**
   * `text` is searched by BM25 and kept as a string. A `uuid` or
   * `datetime` (RFC 3339, or milliseconds) is given and returned as a string.
   */
  type:
    | "string"
    | "number"
    | "int"
    | "bool"
    | "uuid"
    | "datetime"
    | "strings"
    | "ints"
    | "numbers"
    | "sparse"
    | "vectors"
    | "text";
  /** BM25's defaults for a `text` attribute: 1.2 and 0.75 when unset. */
  k1?: Maybe<number>;
  b?: Maybe<number>;
  /** The stemming language of a `text` attribute: `english` when unset, or `none`. */
  language?: Maybe<TextLanguage>;
  /** Whether a `text` attribute drops its language's stopwords; false when unset. */
  stopwords?: Maybe<boolean>;
  /** Whether a `text` attribute stems words; true when unset. */
  stemming?: Maybe<boolean>;
  /** Whether a `text` attribute is also filtered by its whole value. */
  filterable?: Maybe<boolean>;
  caseSensitive?: Maybe<boolean>;
  /** Letters with accents match the same letters without them. */
  asciiFolding?: Maybe<boolean>;
  /** Longer words are left out; 39 when unset. */
  maxTokenLength?: Maybe<number>;
  /** A list of strings, each one word as it is. */
  preTokenized?: Maybe<boolean>;
  /**
   * Keeps the rows sorted by this attribute too, so a query whose filter
   * passes few rows reads only those. For one value: not a list, `sparse`
   * or `vectors`. Turned on later, it is built by the next build.
   */
  filterIndex?: Maybe<boolean>;
}

export type TextLanguage =
  | "english"
  | "arabic"
  | "danish"
  | "dutch"
  | "finnish"
  | "french"
  | "german"
  | "greek"
  | "hungarian"
  | "italian"
  | "norwegian"
  | "portuguese"
  | "romanian"
  | "russian"
  | "spanish"
  | "swedish"
  | "tamil"
  | "turkish"
  | "none";

export interface IndexSchema {
  vectors: VectorColumn[];
  attributes: AttributeColumn[];
  /**
   * `uuid` makes every id a UUID, stored in 16 bytes: given as text with or
   * without dashes in any case, returned lowercase with dashes. Unset, an
   * id is a string or a whole number. It can't change.
   */
  id?: Maybe<"uuid">;
}

export type DocId = string | number;
/** A sparse vector: indices, each with its weight. */
export interface SparseVector {
  indices: number[];
  values: number[];
}
export type AttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | SparseVector
  /** Vectors of one length, for late interaction. */
  | number[][];

export interface IndexDoc {
  /** A string, or a whole number from 0; a UUID in an index of UUID ids. */
  id: DocId;
  /** A vector for every vector column; `{}` when there are none. */
  vectors: Record<string, number[]>;
  attributes?: Record<string, AttributeValue>;
}

/**
 * `{and: [...]}`, `{or: [...]}`, `{not: ...}`, or `{<attribute>: {<op>: value}}`.
 * On a list attribute, an op holds if it holds for any item, except
 * `contains_all`. `glob`, `iglob` (any case) and `regex` match strings.
 */
export type IndexFilter<V = AttributeValue> =
  | { and: IndexFilter<V>[] }
  | { or: IndexFilter<V>[] }
  | { not: IndexFilter<V> }
  | { [attribute: string]: { [op in FilterOp]?: V | V[] } };

export type FilterOp =
  | "eq"
  | "ne"
  | "in"
  | "not_in"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains_all"
  | "contains_any"
  | "glob"
  | "iglob"
  | "regex"
  | "phrase"
  | "prefix"
  | "contains_all_tokens"
  | "contains_any_token";

/** A write's condition: values may name the new document's attribute. */
export type IndexCondition = IndexFilter<AttributeValue | { $ref_new: string }>;

export interface IndexQuery {
  column: string;
  vector: number[];
  topK: number;
  /**
   * The share of the true nearest `topK` to find, from 0 to 1. The index
   * reads as much as its build measured that takes. 0.95 when unset; 1 reads
   * every cluster and returns exactly the true nearest, by the column's metric.
   */
  recall?: Maybe<number>;
  /** Clusters to read, instead of what `recall` needs. More is slower and finds more. */
  probe?: Maybe<number>;
  filter?: Maybe<IndexFilter>;
  /** Attributes to return with each hit. */
  include?: Maybe<string[]>;
  /** Hits to skip before the first returned, for pages. */
  offset?: Maybe<number>;
  per?: Maybe<IndexPer>;
}

/** At most `limit` hits for each set of values of `attributes`. */
export interface IndexPer {
  attributes: string[];
  limit: number;
}

export interface IndexHit {
  id: DocId;
  /** Smaller is closer, for every metric. */
  distance: number;
  attributes: Record<string, AttributeValue>;
}

export interface IndexSearch {
  query: string;
  /** Text attributes to search; every one when unset. */
  fields?: Maybe<string[]>;
  /** A weight per field in `fields`; 1 when missing. */
  boosts?: Maybe<Record<string, number>>;
  topK: number;
  /** BM25's parameters for this query; the first field's when unset. */
  k1?: Maybe<number>;
  b?: Maybe<number>;
  /**
   * As for `query`, plus `{<text attribute>: {phrase: "..."}}`,
   * `{prefix: "..."}`, `{contains_all_tokens: "..."}` and
   * `{contains_any_token: "..."}` at the top or inside `and`.
   */
  filter?: Maybe<IndexFilter>;
  include?: Maybe<string[]>;
  /** Text attributes to return the best fragment of, marked. */
  highlight?: Maybe<string[]>;
  offset?: Maybe<number>;
  per?: Maybe<IndexPer>;
  /** Also match words within this many edits, 0 to 2. */
  fuzzy?: Maybe<number>;
  /** The last word also matches the longer words it starts. */
  lastAsPrefix?: Maybe<boolean>;
}

export interface IndexHighlight {
  text: string;
  /** `[start, end]` of each matched token, in string indices. */
  marks: [number, number][];
}

export interface IndexSearchHit {
  id: DocId;
  /** BM25: larger is better. */
  score: number;
  attributes: Record<string, AttributeValue>;
  highlights: Record<string, IndexHighlight>;
}

export interface IndexHybrid {
  /** Each has `vector` or `text`. */
  searches: { name: string; vector?: Maybe<IndexQuery>; text?: Maybe<IndexSearch> }[];
  topK: number;
  /** The rank constant: 60 when unset. */
  k?: Maybe<number>;
  /** Per search name; 1 when missing. */
  weights?: Maybe<Record<string, number>>;
  offset?: Maybe<number>;
  per?: Maybe<IndexPer>;
  /** Scores the hits by an expression instead of reciprocal rank. */
  rank?: Maybe<IndexScore>;
}

/**
 * A score, larger is better: a number, a search's score (BM25, or the distance
 * of a vector search; 0 when it missed), a number, int, datetime or bool
 * attribute (0 when missing), or a combination.
 */
export type IndexScore =
  | number
  | { search: string }
  | { attribute: string }
  | { sum: IndexScore[] }
  | { product: IndexScore[] }
  | { max: IndexScore[] }
  | { min: IndexScore[] }
  /** 1 at `origin`, halving every `scale` away from it. */
  | { decay: { of: IndexScore; origin: number; scale: number } }
  /** `x / (x + k)`. */
  | { saturate: { of: IndexScore; k: number } }
  /** How far `of` is from `origin`, either way. */
  | { dist: { of: IndexScore; origin: number } }
  | { pow: { of: IndexScore; exponent: number } }
  /** 1 when the document passes the filter, else 0. */
  | { filter: IndexFilter }
  /** The dot product of a `sparse` attribute with this one; indices rise. */
  | { dot: SparseVector & { attribute: string } }
  /** For each vector, its best dot product with one of a `vectors` attribute, summed. */
  | { max_sim: { attribute: string; vectors: number[][] } };

export interface IndexFusedHit {
  id: DocId;
  /** The sum of `weight / (k + rank)` over the searches that found it. */
  score: number;
  ranks: Record<string, number>;
  /** The distance or BM25 score in each search that found it. */
  scores: Record<string, number>;
  attributes: Record<string, AttributeValue>;
  highlights: Record<string, IndexHighlight>;
}

export interface IndexStats {
  rows: number;
  deletedRows: number;
  segments: number;
  indexedRows: number;
  unindexedRows: number;
  clusters: number;
  bytes: number;
}

/**
 * One write, applied as one change, in this order: `deleteBy`, `patchBy`,
 * `upserts`, `patches`, `deletes`. A condition is checked against each
 * document as it was before the write; a missing one has no attributes.
 */
export interface IndexWrite {
  upserts?: Maybe<IndexDoc[]>;
  /** Attributes to set; `null` removes one. A missing document is skipped. */
  patches?: Maybe<{ id: DocId; attributes: Record<string, AttributeValue | null> }[]>;
  deletes?: Maybe<DocId[]>;
  upsertIf?: Maybe<IndexCondition>;
  patchIf?: Maybe<IndexCondition>;
  deleteIf?: Maybe<IndexCondition>;
  deleteBy?: Maybe<IndexFilter>;
  patchBy?: Maybe<{ filter: IndexFilter; attributes: Record<string, AttributeValue | null> }>;
  /** Also return the ids behind the counts. Off by default. */
  returnAffectedIds?: Maybe<boolean>;
  /** Count and note only deletes of ids that were there. Off: every id counts. */
  exactDeletes?: Maybe<boolean>;
}

export interface IndexCounts {
  upserted: number;
  patched: number;
  deleted: number;
  /** With `exactDeletes`: deletes of ids that were not there, not in `deleted`. */
  missing: number;
  /** With `returnAffectedIds`: one id for each count. */
  upsertedIds?: DocId[];
  patchedIds?: DocId[];
  deletedIds?: DocId[];
}

/** Documents in the order of an attribute, or of `id`; those without it last. */
export interface IndexOrderKey {
  by: string;
  descending?: Maybe<boolean>;
}

export interface IndexOrder {
  by: string;
  descending?: Maybe<boolean>;
  /** More keys, for ties on the ones before; up to 8 keys in all. */
  thenBy?: Maybe<IndexOrderKey[]>;
  /** Missing values sort below every value; otherwise they come last either way. */
  missingLowest?: Maybe<boolean>;
  topK: number;
  offset?: Maybe<number>;
  filter?: Maybe<IndexFilter>;
  include?: Maybe<string[]>;
}

export interface IndexRow {
  id: DocId;
  attributes: Record<string, AttributeValue>;
}

/** Every document that passes the filter, scored exactly, best first; those scoring 0 left out. */
export interface IndexRank {
  score: IndexScore;
  topK: number;
  offset?: Maybe<number>;
  filter?: Maybe<IndexFilter>;
  include?: Maybe<string[]>;
}

export interface IndexRanked {
  id: DocId;
  score: number;
  attributes: Record<string, AttributeValue>;
}

export type IndexMeasure = ["count"] | ["count" | "sum" | "avg" | "min" | "max", string];

export interface IndexAggregate {
  filter?: Maybe<IndexFilter>;
  /** One group per set of values; one group of all when unset. */
  groupBy?: Maybe<string[]>;
  /** Lists in `groupBy` grouped by each distinct item instead. */
  each?: Maybe<string[]>;
  /** Each measure by the name it is returned under. */
  measures: Record<string, IndexMeasure>;
}

export interface IndexGroup {
  key: Record<string, AttributeValue>;
  values: Record<string, AttributeValue>;
}

/** One request of `multi`: exactly one field. */
export interface IndexRequest {
  query?: Maybe<IndexQuery>;
  search?: Maybe<IndexSearch>;
  hybrid?: Maybe<IndexHybrid>;
  order?: Maybe<IndexOrder>;
  aggregate?: Maybe<IndexAggregate>;
  rank?: Maybe<IndexRank>;
}

/** The answer to a request, in the field it was asked in. */
export interface IndexResult {
  query?: IndexHit[];
  search?: IndexSearchHit[];
  hybrid?: IndexFusedHit[];
  order?: IndexRow[];
  aggregate?: IndexGroup[];
  rank?: IndexRanked[];
}

export interface IndexMultiOptions {
  /** Read a snapshot up to a minute old when one was seen, instead of the newest. */
  eventual?: Maybe<boolean>;
  /**
   * A number the caller raises whenever the branch may have moved, and never repeats. While
   * it stays the same, the newest snapshot is the one read last, and the bucket is not asked
   * again.
   */
  epoch?: Maybe<number>;
}

/** What `multi` read, by where it came from. Head reads are not counted. */
export interface IndexReads {
  memory: number;
  disk: number;
  store: number;
  /** "hot": all from memory; "warm": some from disk; "cold": some from object storage. */
  temperature: "hot" | "warm" | "cold";
  /** The share of reads a cache served. */
  hitRatio: number;
}

export interface IndexAnswers {
  results: IndexResult[];
  reads: IndexReads;
}

export interface IndexOpenOptions {
  /** Shards the documents are split over: 1 to 256, 1 when unset. Give the same number on every open. */
  shards?: number;
  /** A key id in the cloud's key service that encrypts every object. s3:// only. */
  kmsKeyId?: string;
  /** A 256-bit key, in base64, sent with every request and never stored. s3:// only. */
  customerKey?: string;
  /** The index's folder in the store the cache nodes (`SKYWAKE_CACHE_NODES`) read, so they serve its blobs. */
  cacheFolder?: string;
  /** Run a builder for every shard of each open branch: true when unset. False when servers split the building and each calls `buildShards`. */
  builders?: boolean;
}

/** Batches of documents; `next` gives `null` at the end. */
export interface IndexExport {
  next(): Promise<IndexDoc[] | null>;
}

/** The bytes of a Parquet file, a row group at a time; `next` gives `null` at the end. */
export interface IndexParquetExport {
  next(): Promise<Buffer | null>;
}

/** A branch at one moment of its history. */
export interface IndexVersion {
  version: string;
  /** Milliseconds since the Unix epoch. */
  time: number;
  rows: number;
}

export interface IndexCollectOptions {
  /** Keeps every version that was a branch's state within this many days. Without it, all. */
  retentionDays?: Maybe<number>;
  /** Keeps whatever is younger than this; eight days by default. */
  graceSeconds?: Maybe<number>;
  dryRun?: Maybe<boolean>;
}

export interface IndexCollected {
  kept: number;
  deleted: number;
  deletedBytes: number;
  missing: number;
}

/** A search index in one store folder. Each call names its branch. */
export interface Index {
  /** Makes the index, with an empty `main` branch. */
  create(schema: IndexSchema): Promise<void>;
  schema(branch: string): Promise<IndexSchema>;
  /**
   * Adds the attributes of `schema` the branch lacks and returns its schema after.
   * One it has keeps its type; vectors can't change.
   */
  alter(branch: string, schema: IndexSchema): Promise<IndexSchema>;
  /**
   * Makes `name` at the head of `from`, or at its version `at`. Nothing is copied. A version
   * that stopped being the branch's state more than `retentionDays` ago is refused.
   */
  fork(
    from: string,
    name: string,
    at?: Maybe<string>,
    retentionDays?: Maybe<number>,
  ): Promise<void>;
  /** Up to `limit` versions of a branch, newest first, after version `after` if given. */
  versions(branch: string, after: Maybe<string>, limit: number): Promise<IndexVersion[]>;
  /**
   * Moves a branch back to an older version, as a new version, and returns that. The history
   * stays. Refuses a version as `fork` does.
   */
  restore(branch: string, version: string, retentionDays?: Maybe<number>): Promise<string>;
  /** Deletes the data no branch uses, nor any version within the retention period. */
  collect(options?: Maybe<IndexCollectOptions>): Promise<IndexCollected>;
  /** Clears these attributes' values, then takes them out of the schema. */
  dropAttributes(branch: string, names: string[]): Promise<IndexSchema>;
  /**
   * Adds the writes of `from` since it forked, or was last merged, to `into`, and returns
   * the rows added. Where both wrote one id, `from`'s write wins.
   */
  merge(into: string, from: string): Promise<number>;
  /** Writes documents; each replaces any earlier one with its id. */
  upsert(branch: string, docs: IndexDoc[]): Promise<void>;
  delete(branch: string, ids: DocId[]): Promise<void>;
  /** Patches, conditions and writes by filter. See `IndexWrite`. */
  write(branch: string, write: IndexWrite): Promise<IndexCounts>;
  order(branch: string, order: IndexOrder): Promise<IndexRow[]>;
  aggregate(branch: string, aggregate: IndexAggregate): Promise<IndexGroup[]>;
  /** Requests on one snapshot, so they see the same documents, and what they read. */
  multi(
    branch: string,
    requests: IndexRequest[],
    options?: Maybe<IndexMultiOptions>,
  ): Promise<IndexAnswers>;
  /** The documents with these ids; those without one are left out. */
  getMany(branch: string, ids: DocId[]): Promise<IndexDoc[]>;
  /** Every current document, a batch at a time. */
  export(branch: string): Promise<IndexExport>;
  /** Every current document as a Parquet file, a row group at a time. */
  exportParquet(branch: string): Promise<IndexParquetExport>;
  /** Copies a branch to a new index at `location`, as its `main`, with as many shards. */
  copy(branch: string, location: string, options?: Maybe<IndexOpenOptions>): Promise<void>;
  query(branch: string, query: IndexQuery): Promise<IndexHit[]>;
  /** The documents that best match a text query, by BM25. */
  search(branch: string, search: IndexSearch): Promise<IndexSearchHit[]>;
  /** Vector and text searches on one snapshot, fused by reciprocal rank. */
  hybrid(branch: string, hybrid: IndexHybrid): Promise<IndexFusedHit[]>;
  /** Up to `limit` documents with ids after `after`, in id order; number ids first. Reads every segment. */
  scan(branch: string, after: DocId | null | undefined, limit: number): Promise<IndexDoc[]>;
  get(branch: string, id: DocId): Promise<IndexDoc | null>;
  /** Clusters the rows written so far, so queries read less. */
  build(branch: string): Promise<void>;
  /** Runs builders for exactly these shards of the branch, stopping the others. */
  buildShards(branch: string, shards: Array<number>): Promise<void>;
  /** Reads what queries read into the caches, so the next ones are fast. */
  warm(branch: string): Promise<void>;
  stats(branch: string): Promise<IndexStats>;
  branches(): Promise<string[]>;
  deleteBranch(name: string): Promise<void>;
  /** Deletes everything in the index's folder. */
  destroy(): Promise<void>;
}

export declare const Index: {
  open(location: string, options?: Maybe<IndexOpenOptions>): Index;
};

export declare function blake3(data: Buffer): Buffer;
export declare function validName(name: string): boolean;
