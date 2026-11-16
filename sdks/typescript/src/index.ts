export {
  Skywake,
  type CreatedKey,
  type DiskSummary,
  type Environment,
  type Key,
  type NewDiskOptions,
  type NewKey,
  type Options,
  type Role,
  type Whoami,
} from "./client.js";
export type { Schemas } from "./core/api.js";
export {
  AuthError,
  Conflict,
  InvalidRequest,
  MergeConflict,
  NotFound,
  PermissionError,
  RateLimited,
  ServerError,
  SkywakeError,
  type ErrorCode,
} from "./core/errors.js";
export { collect, type Page } from "./core/paging.js";
export { retryingFetch, type RetryOptions } from "./core/retry.js";
export { resolveSettings, type Asked, type Settings } from "./core/settings.js";
export type { Content, FileChange } from "./disks/changes.js";
export {
  Disk,
  type Branch,
  type Change,
  type Commit,
  type Committed,
  type DiskBranch,
  type DiskInfo,
  type DiskSettings,
  type Entry,
  type FileHit,
  type FindOptions,
  type Found,
  type GrepOptions,
  type ListOptions,
  type Match,
  type MergeOptions,
  type Merged,
  type ReadOptions,
  type Visibility,
  type WriteOptions,
} from "./disks/disk-handle.js";
export type { FolderOptions } from "./disks/folders.js";
export { Index } from "./indexes/index-handle.js";
export type {
  AggregateOptions,
  DocId,
  Fields,
  Filter,
  Group,
  Hit,
  IndexInfo,
  IndexSchema,
  IndexSettings,
  IndexSummary,
  Mode,
  NewIndexOptions,
  NewRow,
  QueryOptions,
  Row,
  Target,
  Upserted,
  Version,
} from "./indexes/types.js";
