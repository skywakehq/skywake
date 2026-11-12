import { createRoute } from "@hono/zod-openapi";

import {
  body,
  errors,
  json,
  noContent,
  orDefault,
  page,
  signedIn,
  signedInOrPublic,
} from "./http.ts";
import { BranchParams, ErrorFields, NamespaceParams, Time, z } from "./schemas.ts";

export const Session = z
  .object({
    id: z.string(),
    label: z.string(),
    actor: z.string().nullable().openapi({
      description:
        "The key or user that started it. Null for callers outside the namespace's organization.",
    }),
    expires_in: z
      .number()
      .openapi({ description: "Seconds until it ends, unless it sends a heartbeat." }),
    created: Time,
  })
  .openapi("Session");

const seconds = z
  .number()
  .optional()
  .openapi({ description: "How long it lives without a heartbeat. 60 seconds by default." });

export const NewSession = z
  .object({ label: orDefault(z.string().max(200), "").openapi({ example: "agent-42" }), seconds })
  .openapi("NewSession");

export const Heartbeat = z.object({ seconds }).openapi("Heartbeat");

const SessionParams = NamespaceParams.extend({
  id: z.string().openapi({ param: { name: "id", in: "path" } }),
});

export const listSessions = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/sessions",
  operationId: "listSessions",
  tags: ["sessions"],
  summary: "The live sessions of the namespace, oldest first.",
  security: signedInOrPublic,
  request: { params: NamespaceParams, query: z.object(page("sessions", "id")) },
  responses: { 200: json(z.array(Session), "The sessions."), ...errors(401, 403, 404) },
});

export const startSession = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/sessions",
  operationId: "startSession",
  tags: ["sessions"],
  security: signedIn,
  request: { params: NamespaceParams, body: body(NewSession) },
  responses: { 201: json(Session, "The session."), ...errors(400, 401, 403, 404) },
});

export const renewSession = createRoute({
  method: "put",
  path: "/namespaces/{namespace}/sessions/{id}",
  operationId: "renewSession",
  tags: ["sessions"],
  summary: "A heartbeat: keeps the session alive.",
  security: signedIn,
  request: { params: SessionParams, body: body(Heartbeat) },
  responses: { 200: json(Session, "The session."), ...errors(400, 401, 403, 404) },
});

export const endSession = createRoute({
  method: "delete",
  path: "/namespaces/{namespace}/sessions/{id}",
  operationId: "endSession",
  tags: ["sessions"],
  summary: "Ends the session now, with its claims.",
  security: signedIn,
  request: { params: SessionParams },
  responses: { 204: noContent, ...errors(401, 403, 404) },
});

export const Claim = z
  .object({ path: z.string(), session: z.string(), label: z.string() })
  .openapi("Claim");

export const ClaimTaken = Claim.extend(ErrorFields).openapi("ClaimTaken");

export const ClaimRequest = z
  .object({
    path: orDefault(z.string().max(4096), "").openapi({
      description: "A file or folder. Empty for the whole branch.",
    }),
    session: z.string(),
  })
  .openapi("ClaimRequest");

export const listClaims = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}/claims",
  operationId: "listClaims",
  tags: ["sessions"],
  summary: "The live claims on the branch, in path order.",
  security: signedInOrPublic,
  request: { params: BranchParams, query: z.object(page("claims", "path")) },
  responses: { 200: json(z.array(Claim), "The claims."), ...errors(401, 403, 404) },
});

export const claimPath = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/branches/{branch}/claims",
  operationId: "claimPath",
  tags: ["sessions"],
  summary:
    "Claims a path for a session, unless a live session holds it, a folder above it or a path below it.",
  security: signedIn,
  request: { params: BranchParams, body: body(ClaimRequest) },
  responses: {
    200: json(Claim, "The claim."),
    409: json(ClaimTaken, "The claim that holds the path."),
    ...errors(400, 401, 403, 404),
  },
});

export const releaseClaim = createRoute({
  method: "delete",
  path: "/namespaces/{namespace}/branches/{branch}/claims",
  operationId: "releaseClaim",
  tags: ["sessions"],
  security: signedIn,
  request: { params: BranchParams, query: ClaimRequest },
  responses: { 204: noContent, ...errors(400, 401, 403, 404) },
});
