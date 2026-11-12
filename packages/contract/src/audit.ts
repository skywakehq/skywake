import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, noContent, page, signedIn } from "./http.ts";
import { Time, z } from "./schemas.ts";

export const AuditOutcome = z.enum(["ok", "denied", "rejected", "error"]).openapi("AuditOutcome", {
  description:
    "`ok`; `denied` for lack of access (401, 403); `rejected` as a bad request (other 4xx); `error` on our side (5xx).",
});

export const AuditEvent = z
  .object({
    id: z.string().openapi({ description: "Pass the last one as `after` for the next page." }),
    at: Time,
    org: z
      .string()
      .nullable()
      .openapi({ description: "The caller's organization; null before sign-in." }),
    owner: z.string().nullable().openapi({
      description: "The organization that owns what was used, when it is not the caller's.",
    }),
    actor: z.string().nullable().openapi({
      description:
        "`key:ID` for an API key, the person's id for the console, or `admin` for the operator.",
    }),
    actorKind: z.enum(["key", "person", "operator", "anonymous"]),
    action: z
      .string()
      .openapi({ description: "The operation, as in this document, such as `createBranch`." }),
    outcome: AuditOutcome,
    status: z.number().int(),
    method: z.string(),
    route: z.string(),
    resource: z.record(z.string(), z.string()).openapi({
      description: "The route's parameters: the namespace, branch, index, path and so on.",
    }),
    details: z.record(z.string(), z.unknown()).nullable(),
    requestId: z.string(),
    clientRequestId: z.string().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    durationMs: z.number(),
    bytesIn: z.number().int().nullable(),
    bytesOut: z.number().int().nullable(),
    chain: z.string().openapi({ description: "The API server that recorded it." }),
    seq: z.number().int(),
    prev: z.string().nullable(),
    hash: z.string().openapi({
      description:
        "sha256 of the event and `prev`, the hash of the event before it on `chain`: a changed or missing event breaks every hash after it.",
    }),
  })
  .openapi("AuditEvent");

export const AuditLog = z
  .object({ events: z.array(AuditEvent), next: z.string().nullable() })
  .openapi("AuditLog");

export const auditLog = createRoute({
  method: "get",
  path: "/audit",
  operationId: "auditLog",
  tags: ["audit"],
  summary: "Every call to the API in the organization, newest first: reads, writes and refusals.",
  security: signedIn,
  request: {
    query: z.object({
      ...page("events", "id"),
      since: Time.optional().openapi({ description: "Only events at or after this time." }),
      until: Time.optional().openapi({ description: "Only events before this time." }),
      actor: z.string().max(200).optional(),
      action: z.string().max(200).optional(),
      outcome: AuditOutcome.optional(),
    }),
  },
  responses: { 200: json(AuditLog, "A page of events."), ...errors(400, 401, 403) },
});

/** An event the console saw itself, such as a sign-in, which never reached this API. */
export const ConsoleEvent = z
  .object({
    at: Time,
    org: z.string().max(200).nullable(),
    actor: z.string().max(200).nullable(),
    action: z.string().min(1).max(200),
    outcome: AuditOutcome,
    status: z.number().int(),
    method: z.string().max(10),
    route: z.string().max(500),
    requestId: z.string().max(200),
    ip: z.string().max(100).nullable(),
    userAgent: z.string().max(500).nullable(),
    details: z.record(z.string(), z.unknown()).nullable(),
  })
  .openapi("ConsoleEvent");

export const recordAuditEvents = createRoute({
  method: "post",
  path: "/audit/events",
  operationId: "recordAuditEvents",
  tags: ["audit"],
  summary:
    "Adds what the console saw itself, such as sign-ins, to the audit log. Admin token only.",
  security: signedIn,
  request: { body: body(z.object({ events: z.array(ConsoleEvent).min(1).max(1000) })) },
  responses: { 204: noContent, ...errors(400, 401) },
});
