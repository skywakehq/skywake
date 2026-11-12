import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, signedIn } from "./http.ts";
import { Time, z } from "./schemas.ts";

export const Region = z
  .object({
    name: z.string().openapi({ example: "eu-central-1" }),
    default: z.boolean().openapi({ description: "Used when no region is asked for." }),
  })
  .openapi("Region");

export const listRegions = createRoute({
  method: "get",
  path: "/regions",
  operationId: "listRegions",
  tags: ["environments"],
  summary: "The regions this server can keep data in.",
  security: signedIn,
  responses: { 200: json(z.array(Region), "The regions."), ...errors(401) },
});

export const Environment = z.object({ name: z.string(), created: Time }).openapi("Environment");

export const listEnvironments = createRoute({
  method: "get",
  path: "/environments",
  operationId: "listEnvironments",
  tags: ["environments"],
  summary: "The environments the caller can reach.",
  security: signedIn,
  responses: { 200: json(z.array(Environment), "The environments."), ...errors(401) },
});

export const NewEnvironment = z
  .object({
    name: z
      .string()
      .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/, "use letters, digits, `.`, `_` and `-`"),
  })
  .openapi("NewEnvironment");

export const createEnvironment = createRoute({
  method: "post",
  path: "/environments",
  operationId: "createEnvironment",
  tags: ["environments"],
  summary: "Makes an environment. It has no region; each namespace and index picks its own.",
  security: signedIn,
  request: { body: body(NewEnvironment) },
  responses: { 201: json(Environment, "The environment."), ...errors(400, 401, 403, 409) },
});
