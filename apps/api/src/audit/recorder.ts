import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { Log } from "../http/log.ts";
import { hashOf, type Sealed } from "./chain.ts";
import type { AuditEvent } from "./event.ts";

export type Sink = (events: Sealed[]) => Promise<void>;

const FLUSH_MS = 1000;
const BATCH = 1000;
const HELD_MAX = 100_000;

export class AuditRecorder {
  readonly chain = `${hostname()}/${randomUUID().slice(0, 8)}`;
  readonly #sink: Sink;
  readonly #log: Log;
  #held: AuditEvent[] = [];
  #sealed: Sealed[] = [];
  #seq = 0;
  #prev: string | null = null;
  #dropped = 0;
  #timer: NodeJS.Timeout | null = null;
  #writing: Promise<void> | null = null;

  constructor(sink: Sink, log: Log) {
    this.#sink = sink;
    this.#log = log;
  }

  record(event: AuditEvent) {
    if (this.#held.length + this.#sealed.length >= HELD_MAX) {
      this.#dropped++;
      return;
    }
    this.#held.push(event);
    if (this.#held.length >= BATCH && !this.#writing) void this.flush();
    else this.#timer ??= setTimeout(() => void this.flush(), FLUSH_MS).unref();
  }

  async flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    while (this.#writing) await this.#writing;
    if (this.#idle()) return;
    this.#writing = this.#drain().finally(() => (this.#writing = null));
    return this.#writing;
  }

  #idle() {
    return this.#held.length === 0 && this.#sealed.length === 0 && this.#dropped === 0;
  }

  async #drain() {
    while (!this.#idle()) {
      this.#seal();
      const batch = this.#sealed.slice(0, BATCH);
      try {
        await this.#sink(batch);
      } catch (error) {
        this.#log({
          level: "error",
          msg: "audit write failed",
          held: this.#sealed.length,
          error: String(error),
        });
        this.#timer ??= setTimeout(() => void this.flush(), FLUSH_MS * 5).unref();
        return;
      }
      this.#sealed = this.#sealed.slice(batch.length);
    }
  }

  #seal() {
    if (this.#dropped > 0) {
      this.#held.unshift(dropped(this.#dropped));
      this.#log({ level: "error", msg: "audit events dropped", count: this.#dropped });
      this.#dropped = 0;
    }
    for (const event of this.#held) {
      const seq = ++this.#seq;
      const hash = hashOf(event, this.chain, seq, this.#prev);
      this.#sealed.push({ ...event, chain: this.chain, seq, prev: this.#prev, hash });
      this.#prev = hash;
    }
    this.#held = [];
  }
}

function dropped(count: number): AuditEvent {
  return {
    at: new Date(),
    org: null,
    owner: null,
    actor: null,
    actorKind: "operator",
    action: "auditEventsDropped",
    outcome: "error",
    status: 0,
    method: "",
    route: "",
    resource: {},
    details: { count },
    requestId: "",
    clientRequestId: null,
    ip: null,
    userAgent: null,
    durationMs: 0,
    bytesIn: null,
    bytesOut: null,
  };
}
