export interface AuditEvent {
  at: Date;
  org: string | null;
  owner: string | null;
  actor: string | null;
  actorKind: ActorKind;
  action: string;
  outcome: Outcome;
  status: number;
  method: string;
  route: string;
  resource: Record<string, string>;
  details: Record<string, unknown> | null;
  requestId: string;
  clientRequestId: string | null;
  ip: string | null;
  userAgent: string | null;
  durationMs: number;
  bytesIn: number | null;
  bytesOut: number | null;
}

export type ActorKind = "key" | "person" | "operator" | "anonymous";
export type Outcome = "ok" | "denied" | "rejected" | "error";

export function outcomeOf(status: number): Outcome {
  if (status < 400) return "ok";
  if (status === 401 || status === 403) return "denied";
  return status < 500 ? "rejected" : "error";
}
