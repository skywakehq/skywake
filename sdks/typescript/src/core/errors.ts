import type { Schemas } from "./api.js";

export type ErrorCode = Schemas["ErrorCode"];

/** An error answer from the API. */
export class SkywakeError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** What kind of error it is, such as `not_found` or `rate_limited`. */
    readonly code: ErrorCode | undefined,
    /** Quote it when you report a bug. */
    readonly requestId: string | undefined,
    /** For an invalid request, the JSON path of the field that is wrong, such as `filter.and[1]`. */
    readonly path?: string,
    /** For a merge or revert that conflicts, the paths in the way. */
    readonly conflicts?: string[],
  ) {
    super(message);
    this.name = "SkywakeError";
  }
}

type Answer<T> = { data?: T; error?: unknown; response: Response };

/** Returns the data of an answer, or throws its error. */
export function unwrap<T>({ data, error, response }: Answer<T>): T {
  if (error !== undefined || !response.ok) {
    const body = (error ?? {}) as Partial<Schemas["ErrorBody"] & Schemas["RevertConflict"]>;
    throw new SkywakeError(
      response.status,
      body.error ?? response.statusText,
      body.code,
      body.request_id ?? response.headers.get("x-request-id") ?? undefined,
      body.path,
      body.conflicts,
    );
  }
  return data as T;
}
