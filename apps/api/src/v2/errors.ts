import type { ErrorCode } from "@skywake/contract";
import { EngineError } from "@skywake/engine";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { HttpError, messageOf } from "../http/errors.ts";
import type { Log } from "../http/log.ts";

const CODES: Partial<Record<number, ErrorCode>> = {
  400: "invalid",
  401: "unauthorized",
  402: "payment_required",
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

const HINTS: Partial<Record<number, string>> = {
  401: "run `skywake login`, or set SKYWAKE_API_KEY to a key from the console",
  403: "see what the key may do: GET /v2/whoami, or `skywake whoami`",
  413: "send fewer rows or smaller files per call; the SDKs split large writes for you",
  429: "wait for the seconds in `Retry-After`, then try again",
};

export interface Details {
  path?: string;
  hint?: string | null;
  conflicts?: string[];
  code?: ErrorCode;
}

export class Failure extends Error {
  readonly status: ContentfulStatusCode;
  readonly details: Details;
  readonly retryAfter: string | null;

  constructor(
    status: ContentfulStatusCode,
    message: string,
    details: Details = {},
    retryAfter: string | null = null,
  ) {
    super(message);
    this.status = status;
    this.details = details;
    this.retryAfter = retryAfter;
  }

  get code(): ErrorCode {
    return this.details.code ?? CODES[this.status] ?? (this.status >= 500 ? "internal" : "invalid");
  }

  get hint() {
    return this.details.hint ?? HINTS[this.status] ?? null;
  }

  static from(status: number, body: unknown, headers?: Headers) {
    const fields = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const message = typeof fields.error === "string" ? fields.error : String(body ?? "error");
    const conflicts = Array.isArray(fields.conflicts)
      ? (fields.conflicts as unknown[]).map(String)
      : undefined;
    return new Failure(
      status as ContentfulStatusCode,
      message,
      {
        path: typeof fields.path === "string" ? fields.path : undefined,
        code: typeof fields.code === "string" ? (fields.code as ErrorCode) : undefined,
        conflicts,
      },
      headers?.get("retry-after") ?? null,
    );
  }
}

export const invalid = (message: string, path?: string, hint?: string) =>
  new Failure(400, path ? `${path}: ${message}` : message, { path, hint });

export const missing = (what: string, hint?: string | null) =>
  new Failure(404, `${what} does not exist`, { hint });

export function failureOf(error: unknown): Failure | null {
  if (error instanceof Failure) return error;
  if (error instanceof HttpError) {
    return new Failure(error.status, error.message, { path: error.path, code: error.code });
  }
  if (error instanceof EngineError && error.kind !== "internal") {
    const status = { not_found: 404, conflict: 409, invalid: 400, unavailable: 503, busy: 429 }[
      error.kind
    ] as ContentfulStatusCode;
    return new Failure(status, error.message);
  }
  if (error instanceof HTTPException && error.status < 500) {
    return new Failure(error.status as ContentfulStatusCode, error.message || "bad request");
  }
  return null;
}

export function errorBody(c: Context, failure: Failure) {
  if (failure.retryAfter) c.header("Retry-After", failure.retryAfter);
  const { path, conflicts } = failure.details;
  return c.json(
    {
      error: {
        code: failure.code,
        message: failure.message,
        hint: failure.hint,
        request_id: (c.get("requestId") as string | undefined) ?? null,
        ...(path === undefined ? {} : { path }),
        ...(conflicts === undefined ? {} : { conflicts }),
      },
    },
    failure.status,
  );
}

export function errorHandler(log: Log) {
  return (error: unknown, c: Context) => {
    const failure = failureOf(error);
    if (failure) return errorBody(c, failure);
    log({
      level: "error",
      msg: "request failed",
      request_id: c.get("requestId") ?? null,
      error: messageOf(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorBody(c, new Failure(500, "internal error"));
  };
}
