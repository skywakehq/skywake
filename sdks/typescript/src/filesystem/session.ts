import { unwrap } from "../core/errors.js";
import type { Namespace } from "./namespace.js";

export class Session {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    readonly namespace: Namespace,
    readonly id: string,
  ) {}

  async heartbeat(seconds?: number): Promise<void> {
    const path = { namespace: this.namespace.name, id: this.id };
    unwrap(
      await this.namespace.client.PUT("/namespaces/{namespace}/sessions/{id}", {
        params: { path },
        body: { seconds },
      }),
    );
  }

  /** Sends a heartbeat every `everyMs` until `end`. */
  keepAlive(everyMs = 20_000): void {
    this.timer ??= setInterval(() => void this.heartbeat().catch(() => {}), everyMs);
  }

  async end(): Promise<void> {
    clearInterval(this.timer);
    const path = { namespace: this.namespace.name, id: this.id };
    unwrap(
      await this.namespace.client.DELETE("/namespaces/{namespace}/sessions/{id}", {
        params: { path },
      }),
    );
  }
}
