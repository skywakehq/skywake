import { createHash } from "node:crypto";

import type { AuditEvent } from "./event.ts";

export interface Sealed extends AuditEvent {
  chain: string;
  seq: number;
  prev: string | null;
  hash: string;
}

export function hashOf(event: AuditEvent, chain: string, seq: number, prev: string | null) {
  const fields = { ...event, at: event.at.toISOString(), chain, seq, prev };
  return createHash("sha256").update(canonical(fields)).digest("hex");
}

export function verify(events: Sealed[]) {
  return events.every(
    (event, i) =>
      (i === 0 || (event.prev === events[i - 1]!.hash && event.seq === events[i - 1]!.seq + 1)) &&
      event.hash === hashOf(strip(event), event.chain, event.seq, event.prev),
  );
}

function strip({ chain: _c, seq: _s, prev: _p, hash: _h, ...event }: Sealed): AuditEvent {
  return event;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
