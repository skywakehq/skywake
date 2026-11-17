import type { Schemas } from "./api.js";

export type ErrorCode = Schemas["ErrorCode"];

interface Fields {
  status: number;
  code: ErrorCode | undefined;
  message: string;
  hint: string | null;
  requestId: string | null;
  path?: string;
}

export class SkywakeError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  readonly hint: string | null;
  readonly requestId: string | null;
  readonly path: string | undefined;

  constructor(fields: Fields) {
    super(fields.hint ? `${fields.message}; ${fields.hint}` : fields.message);
    this.name = new.target.name;
    this.status = fields.status;
    this.code = fields.code;
    this.hint = fields.hint;
    this.requestId = fields.requestId;
    this.path = fields.path;
  }
}

export class AuthError extends SkywakeError {}
export class PermissionError extends SkywakeError {}
export class NotFound extends SkywakeError {}
export class Conflict extends SkywakeError {}
export class InvalidRequest extends SkywakeError {}
export class ServerError extends SkywakeError {}

export class MergeConflict extends Conflict {
  readonly conflicts: string[];

  constructor(fields: Fields, conflicts: string[]) {
    super(fields);
    this.conflicts = conflicts;
  }
}

export class RateLimited extends SkywakeError {
  readonly retryAfter: number | null;

  constructor(fields: Fields, retryAfter: number | null) {
    super(fields);
    this.retryAfter = retryAfter;
  }
}

type Body = { error?: Partial<Schemas["Error"]["error"]> | string; code?: ErrorCode };

export function errorOf(response: Response, body: unknown): SkywakeError {
  const raw = (body ?? {}) as Body;
  const error = typeof raw.error === "object" ? raw.error : { message: raw.error, code: raw.code };
  const fields: Fields = {
    status: response.status,
    code: error.code,
    message: error.message ?? (response.statusText || `HTTP ${response.status}`),
    hint: error.hint ?? null,
    requestId: error.request_id ?? response.headers.get("x-request-id"),
    path: error.path,
  };
  const status = response.status;
  if (status === 401) return new AuthError(fields);
  if (status === 403) return new PermissionError(fields);
  if (status === 404) return new NotFound(fields);
  if (status === 409 && error.conflicts?.length) return new MergeConflict(fields, error.conflicts);
  if (status === 409) return new Conflict(fields);
  if (status === 429) {
    const after = Number(response.headers.get("retry-after"));
    return new RateLimited(fields, Number.isFinite(after) && after > 0 ? after : null);
  }
  if (status >= 500) return new ServerError(fields);
  return new InvalidRequest(fields);
}
