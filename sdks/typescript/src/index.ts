export {
  Skywake,
  type CreatedKey,
  type Environment,
  type Key,
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
export { Index } from "./indexes/index-handle.js";
export type {
  AggregateOptions,
  Branch,
  DocId,
  Fields,
  IndexRows,
  RowsOf,
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
