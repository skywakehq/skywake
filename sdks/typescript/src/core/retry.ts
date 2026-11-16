export interface RetryOptions {
  retries?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const MAX_WAIT_MS = 60_000;

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
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new DOMException("no answer in time", "TimeoutError")),
        timeoutMs,
      );
      const cancel = () => controller.abort(request.signal.reason);
      if (request.signal.aborted) cancel();
      else request.signal.addEventListener("abort", cancel, { once: true });
      let response: Response;
      try {
        response = await send(request.clone(), { signal: controller.signal });
      } catch (error) {
        if (last || !idempotent || request.signal.aborted) throw error;
        mayHaveLanded = true;
        await sleep(backoff(attempt, backoffMs));
        continue;
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", cancel);
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

const backoff = (attempt: number, base: number) =>
  Math.random() * Math.min(MAX_WAIT_MS, base * 2 ** attempt);

function retryAfter(response: Response) {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
