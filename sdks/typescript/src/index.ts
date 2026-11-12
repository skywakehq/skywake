// The Skywake client: a small layer over the client generated from the
// API's OpenAPI document. Filesystems are namespaces; `index` reaches a
// search index.

export { Skywake, type Options } from "./client.js";
export type { Schemas } from "./core/api.js";
export { SkywakeError, type ErrorCode } from "./core/errors.js";
export type { Page } from "./core/paging.js";
export { retryingFetch, type RetryOptions } from "./core/retry.js";
export {
  Branch,
  type At,
  type CommitOptions,
  type DiffOptions,
  type FileChange,
  type ReadRange,
  type TreeEntry,
} from "./filesystem/branch.js";
export type { CheckoutOptions, CommitFolderOptions } from "./filesystem/folders.js";
export { Namespace, type MergeOptions, type Resolution } from "./filesystem/namespace.js";
export { Session } from "./filesystem/session.js";
export { Indexes } from "./indexes/indexes.js";
export { SearchIndex } from "./indexes/search-index.js";
export { syncIndex, type SyncOptions, type Synced, type SyncedFile } from "./indexes/sync.js";
export { Keys, type NewKeyOptions, type Role } from "./keys/keys.js";
export type {
  DocId,
  Document,
  IndexQuery,
  IndexWrite,
  IndexFilter,
  IndexOrder,
  IndexRank,
  Ranked,
  IndexAggregate,
  IndexMulti,
  NewIndexOptions,
  Patch,
  Row,
  Group,
  WriteCounts,
  Rerank,
  DocumentPage,
  DocumentCursor,
  Measured,
  Billing,
  Operation,
  IndexVersion,
  IndexPinned,
  IndexPinning,
  Performance,
  Consistency,
} from "./indexes/types.js";
