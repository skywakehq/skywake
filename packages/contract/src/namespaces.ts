import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, noContent, orDefault, signedIn, signedInOrPublic } from "./http.ts";
import { Name, NamespaceParams, Time, Visibility, z } from "./schemas.ts";

export const Namespace = z
  .object({ name: z.string(), region: z.string(), visibility: Visibility, created: Time })
  .openapi("Namespace");

export const NewNamespace = z
  .object({
    name: Name.openapi({ example: "prod/app" }),
    region: z.string().optional().openapi({
      description: "Where its data lives. It can't change later. The default region if not given.",
    }),
    visibility: orDefault(Visibility, "private"),
  })
  .openapi("NewNamespace");

export const NamespaceUpdate = z.object({ visibility: Visibility }).openapi("NamespaceUpdate");

export const listNamespaces = createRoute({
  method: "get",
  path: "/namespaces",
  operationId: "listNamespaces",
  tags: ["namespaces"],
  summary: "The namespaces the caller can reach.",
  security: signedIn,
  responses: { 200: json(z.array(Namespace), "The namespaces."), ...errors(401) },
});

export const createNamespace = createRoute({
  method: "post",
  path: "/namespaces",
  operationId: "createNamespace",
  tags: ["namespaces"],
  summary: "Makes a namespace: its own folder of the store, private unless asked.",
  security: signedIn,
  request: { body: body(NewNamespace) },
  responses: { 201: json(Namespace, "The namespace."), ...errors(400, 401, 403, 409) },
});

export const getNamespace = createRoute({
  method: "get",
  path: "/namespaces/{namespace}",
  operationId: "getNamespace",
  tags: ["namespaces"],
  security: signedInOrPublic,
  request: { params: NamespaceParams },
  responses: { 200: json(Namespace, "The namespace."), ...errors(401, 403, 404) },
});

export const updateNamespace = createRoute({
  method: "patch",
  path: "/namespaces/{namespace}",
  operationId: "updateNamespace",
  tags: ["namespaces"],
  summary: "Makes a namespace public or private.",
  security: signedIn,
  request: { params: NamespaceParams, body: body(NamespaceUpdate) },
  responses: { 204: noContent, ...errors(400, 401, 403, 404) },
});
