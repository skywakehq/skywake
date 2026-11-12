/** How the client retries and times out requests. */
export interface RetryOptions {
  /** Tries after the first. 3 by default; 0 turns retries off. */
  retries?: number;
  /**
   * How long one try may wait for the answer to start, in milliseconds. Reading
   * the body after that has no limit, so large files are not cut off. 60 seconds
   * by default.
   */
  timeoutMs?: number;
  /** The first wait before a retry, in milliseconds. It doubles each time. 200 by default. */
  backoffMs?: number;
}

// Sending these again has the same effect as sending them once.
const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
// The server asks for at most 60 seconds; waiting less would only be refused again.
const MAX_WAIT_MS = 60_000;

/**
 * A fetch that retries network errors and 5xx answers of idempotent requests,
 * and 429 answers of any request: the server refuses those before doing anything.
 *
 * A DELETE that failed that way may still have landed, so if a retry of it
 * then finds nothing (404), it answers 204: what it deleted is gone either way.
 */
export function retryingFetch(
  options: RetryOptions = {},
  send: typeof fetch = globalThis.fetch,
): (request: Request) => Promise<Response> {
  const { retries = 3, timeoutMs = 60_000, backoffMs = 200 } = options;
  return async (request) => {
    const idempotent = IDEMPOTENT.has(request.method);
    let mayHaveLanded = false;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= retries;
      const timeout = new AbortController();
      const timer = setTimeout(
        () => timeout.abort(new DOMException("no answer in time", "TimeoutError")),
        timeoutMs,
      );
      const signal = AbortSignal.any([request.signal, timeout.signal]);
      let response: Response;
      try {
        response = await send(new Request(request.clone(), { signal }));
      } catch (error) {
        if (last || !idempotent || request.signal.aborted) throw error;
        mayHaveLanded = true;
        await sleep(backoff(attempt, backoffMs));
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (mayHaveLanded && request.method === "DELETE" && response.status === 404) {
        await response.body?.cancel();
        return new Response(null, { status: 204 });
      }
      const again = response.status === 429 || (idempotent && response.status >= 500);
      if (last || !again) return response;
      mayHaveLanded ||= response.status >= 500;
      const wait = retryAfter(response) ?? backoff(attempt, backoffMs);
      await response.body?.cancel();
      await sleep(Math.min(wait, MAX_WAIT_MS));
    }
  };
}

// Full jitter, so many clients that failed together do not retry together.
const backoff = (attempt: number, base: number) =>
  Math.random() * Math.min(MAX_WAIT_MS, base * 2 ** attempt);

function retryAfter(response: Response) {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
