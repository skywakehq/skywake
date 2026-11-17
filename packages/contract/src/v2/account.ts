import { createRoute, z } from "@hono/zod-openapi";

import { Environment, NewEnvironment } from "../environments.ts";
import { CreatedKey, Key, NewKey, Whoami } from "../keys.ts";
import { NewLogin, StartedLogin } from "../logins.ts";
import { body, done, errors, json, listOf, PageQuery, security } from "./common.ts";

export const KeyV2 = Key.omit({ namespaces: true }).openapi("KeyV2");
export const NewKeyV2 = NewKey.omit({ namespaces: true }).openapi("NewKeyV2");

export const whoami = createRoute({
  method: "get",
  path: "/whoami",
  operationId: "whoami",
  tags: ["account"],
  security,
  summary: "The organization, environment and role of the key.",
  responses: { 200: json(Whoami, "Who is calling."), ...errors(403) },
});

export const listKeys = createRoute({
  method: "get",
  path: "/keys",
  operationId: "listKeys",
  tags: ["account"],
  security,
  request: { query: z.object(PageQuery) },
  responses: { 200: json(listOf(KeyV2, "KeyList"), "The keys."), ...errors(403) },
});

export const createKey = createRoute({
  method: "post",
  path: "/keys",
  operationId: "createKey",
  tags: ["account"],
  security,
  summary: "Makes a key. Its secret is in the answer, and never shown again.",
  request: { body: body(NewKeyV2) },
  responses: { 201: json(CreatedKey, "The key."), ...errors(400, 403) },
});

export const revokeKey = createRoute({
  method: "delete",
  path: "/keys/{id}",
  operationId: "revokeKey",
  tags: ["account"],
  security,
  request: { params: z.object({ id: z.string().openapi({ param: { name: "id", in: "path" } }) }) },
  responses: { 204: done, ...errors(403, 404) },
});

export const listEnvironments = createRoute({
  method: "get",
  path: "/environments",
  operationId: "listEnvironments",
  tags: ["account"],
  security,
  request: { query: z.object(PageQuery) },
  responses: { 200: json(listOf(Environment, "EnvironmentList"), "The environments.") },
});

export const createEnvironment = createRoute({
  method: "post",
  path: "/environments",
  operationId: "createEnvironment",
  tags: ["account"],
  security,
  request: { body: body(NewEnvironment) },
  responses: { 201: json(Environment, "The environment."), ...errors(400, 403, 409) },
});

export const startLogin = createRoute({
  method: "post",
  path: "/logins",
  operationId: "startLogin",
  tags: ["account"],
  security: [],
  summary:
    "Starts a sign-in from the CLI. The CLI makes a key and sends only its id and hash; a person " +
    "approves the code in the console, and the key starts to work.",
  request: { body: body(NewLogin) },
  responses: { 201: json(StartedLogin, "The code to approve."), ...errors(400, 409, 503) },
});

export const routes = [
  whoami,
  listKeys,
  createKey,
  revokeKey,
  listEnvironments,
  createEnvironment,
  startLogin,
];
