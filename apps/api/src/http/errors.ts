import type { ErrorCode } from "@skywake/contract";
import { EngineError } from "@skywake/engine";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { Log } from "./log.ts";

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  /** The JSON path of the field that is wrong, if one is. */
  readonly path: string | undefined;
  /** A more exact code than the status gives. */
  readonly code: ErrorCode | undefined;

  constructor(status: ContentfulStatusCode, message: string, path?: string, code?: ErrorCode) {
    super(message);
    this.status = status;
    this.path = path;
    this.code = code;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
/** A field of the request is wrong: `path` names it, such as `filter.and[1].price`. */
export const invalidAt = (path: string, message: string) =>
  new HttpError(400, `${path}: ${message}`, path);

/** `["filter", "and", 1, "price"]` as `filter.and[1].price`. */
export const jsonPath = (parts: readonly PropertyKey[]) =>
  parts
    .map((part, i) =>
      typeof part === "number" ? `[${part}]` : `${i === 0 ? "" : "."}${String(part)}`,
    )
    .join("");
export const unauthorized = () => new HttpError(401, "a valid API key or token is needed");
export const forbidden = (message: string) => new HttpError(403, message);
export const notFound = (what: string) => new HttpError(404, `${what} does not exist`);
export const conflict = (message: string) => new HttpError(409, message);

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Whether the engine failed because what was asked for is not there. */
export const isMissing = (error: unknown) =>
  error instanceof EngineError && error.kind === "not_found";

const CODES: Partial<Record<number, ErrorCode>> = {
  400: "invalid",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "too_large",
  415: "unsupported_media_type",
  429: "rate_limited",
  501: "not_implemented",
  503: "unavailable",
};

/** The fields of every error answer, for answers that add their own. */
export function errorFields(c: Context, status: number, message: string, code?: ErrorCode) {
  return {
    error: message,
    code: code ?? CODES[status] ?? (status >= 500 ? "internal" : "invalid"),
    request_id: (c.get("requestId") as string | undefined) ?? null,
  };
}

/** The one shape of every error answer. */
export function errorBody(
  c: Context,
  status: ContentfulStatusCode,
  message: string,
  path?: string,
  code?: ErrorCode,
) {
  const body = errorFields(c, status, message, code);
  return c.json(path === undefined ? body : { ...body, path }, status);
}

const ENGINE_STATUS = {
  not_found: 404,
  conflict: 409,
  invalid: 400,
  unavailable: 503,
  // Writes arrive faster than the index stores or builds them.
  busy: 429,
} as const;

export function errorHandler(log: Log) {
  return (error: unknown, c: Context) => {
    if (error instanceof HttpError) {
      return errorBody(c, error.status, error.message, error.path, error.code);
    }
    if (error instanceof EngineError && error.kind !== "internal") {
      return errorBody(c, ENGINE_STATUS[error.kind], error.message);
    }
    if (error instanceof HTTPException && error.status < 500) {
      return errorBody(c, error.status, error.message || "bad request");
    }
    log({
      level: "error",
      msg: "request failed",
      request_id: c.get("requestId") ?? null,
      error: messageOf(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorBody(c, 500, "internal error");
  };
}
