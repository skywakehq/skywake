import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

/** The API's Prometheus metrics. Served on their own port, never on the public one. */
export class Metrics {
  readonly registry = new Registry();
  readonly #requests = new Counter({
    name: "skywake_api_requests_total",
    help: "Requests answered, by route and status.",
    labelNames: ["method", "route", "status"],
    registers: [this.registry],
  });
  readonly #seconds = new Histogram({
    name: "skywake_api_request_seconds",
    help: "Time to answer a request, by route.",
    labelNames: ["method", "route"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  constructor(processMetrics = false) {
    if (processMetrics) collectDefaultMetrics({ register: this.registry });
  }

  /** `route` is the route's pattern, never the raw path, so labels stay few. */
  request(method: string, route: string, status: number, seconds: number) {
    this.#requests.inc({ method, route, status: String(status) });
    this.#seconds.observe({ method, route }, seconds);
  }
}
