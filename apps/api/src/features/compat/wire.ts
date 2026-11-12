import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { gunzipSync } from "node:zlib";

import type { Ctx } from "../../http/context.ts";
import { badRequest, errorHandler, HttpError } from "../../http/errors.ts";
import type { Log } from "../../http/log.ts";

export async function bodyOf(c: Ctx): Promise<Record<string, unknown>> {
  const raw = Buffer.from(await c.req.arrayBuffer());
  const gzipped = c.req.header("content-encoding")?.toLowerCase() === "gzip";
  const bytes = gzipped ? gunzip(raw, c.var.services.config.bodyLimit) : raw;
  if (bytes.length === 0) return {};
  let body: unknown;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw badRequest("the body is not JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("the body is a JSON object");
  }
  return body as Record<string, unknown>;
}

// The body limit counts compressed bytes, so a small gzip body could unpack
// to many gigabytes. The unpacked body gets the same limit.
function gunzip(raw: Buffer, limit: number) {
  try {
    return gunzipSync(raw, { maxOutputLength: limit });
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
      throw new HttpError(413, "the request is too large");
    }
    throw badRequest("the body is not valid gzip");
  }
}

export function errors(log: Log) {
  const handle = errorHandler(log);
  return async (error: unknown, c: Context) => {
    const answer = await handle(error, c);
    const status = answer.status as ContentfulStatusCode;
    const retry = status >= 500 || status === 408 || status === 429;
    const body = (await answer.json()) as Record<string, unknown>;
    return c.json({ status: "error", ...body }, status, retry ? {} : { "x-should-retry": "false" });
  };
}

export const queryBilling = (rows: unknown) => ({
  billable_logical_bytes_queried: 0,
  billable_logical_bytes_returned: Buffer.byteLength(JSON.stringify(rows ?? [])),
});

interface Reads {
  server_ms: number;
  cache_temperature: string;
  cache_hit_ratio: number;
}

export const queryPerformance = (reads: Reads, rows: number, started: number) => ({
  approx_namespace_size: rows,
  cache_hit_ratio: reads.cache_hit_ratio,
  cache_temperature: reads.cache_temperature,
  exhaustive_search_count: 0,
  query_execution_ms: reads.server_ms,
  server_total_ms: Math.round(performance.now() - started),
});
