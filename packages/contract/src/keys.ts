import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, noContent, orDefault, signedIn } from "./http.ts";
import { NamespacePattern, Role, Time, z } from "./schemas.ts";

export const Key = z
  .object({
    id: z.string(),
    name: z.string(),
    role: Role,
    namespaces: z.string().openapi({
      description: "A namespace name, `<folder>/*` for every namespace under it, or `*`.",
    }),
    expires: Time.nullable(),
    last_used: Time.nullable(),
    created: Time,
    created_by: z
      .string()
      .nullable()
      .openapi({
        description:
          "Who made the key: `user:<id>` for a person in the console, `key:<id>` for another " +
          "key. Null for keys made before this was kept.",
      }),
    created_by_email: z.string().nullable().openapi({
      description: "The email of the person who made it, when a person did.",
    }),
  })
  .openapi("Key");

export const NewKey = z
  .object({
    name: z.string().min(1).max(100),
    role: Role,
    namespaces: orDefault(NamespacePattern, "*").openapi({
      description:
        "A namespace name, `<folder>/*` for every namespace under a folder, or `*` for all of " +
        "them, the default.",
    }),
    expires_in_days: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .optional()
      .openapi({
        description:
          "Whole days, 1 to 3650. Without it, the key does not expire. A key never outlives the " +
          "key that makes it: it expires then at the latest.",
      }),
  })
  .openapi("NewKey");

export const CreatedKey = z
  .object({
    id: z.string(),
    key: z.string().openapi({ description: "The key. It is shown only this once." }),
  })
  .openapi("CreatedKey");

export const listKeys = createRoute({
  method: "get",
  path: "/keys",
  operationId: "listKeys",
  tags: ["keys"],
  summary: "The organization's API keys. Never the keys themselves.",
  security: signedIn,
  responses: { 200: json(z.array(Key), "The keys."), ...errors(401, 403) },
});

export const createKey = createRoute({
  method: "post",
  path: "/keys",
  operationId: "createKey",
  tags: ["keys"],
  summary: "Creates an API key. It can reach only namespaces the caller can reach.",
  security: signedIn,
  request: { body: body(NewKey) },
  responses: { 201: json(CreatedKey, "The new key."), ...errors(400, 401, 403) },
});

export const revokeMemberKeys = createRoute({
  method: "delete",
  path: "/orgs/{org}/members/{user}/keys",
  operationId: "revokeMemberKeys",
  tags: ["keys"],
  summary:
    "Revokes every key a person made in the organization, and the keys those keys made. " +
    "The console calls it when someone leaves or is removed. Needs the server's admin token.",
  security: signedIn,
  request: {
    params: z.object({
      org: z.string().openapi({ param: { name: "org", in: "path" } }),
      user: z.string().openapi({ param: { name: "user", in: "path" } }),
    }),
  },
  responses: {
    200: json(z.object({ revoked: z.number().int() }).openapi("RevokedKeys"), "How many keys."),
    ...errors(401),
  },
});

export const deleteKey = createRoute({
  method: "delete",
  path: "/keys/{id}",
  operationId: "deleteKey",
  tags: ["keys"],
  summary: "Revokes an API key at once.",
  security: signedIn,
  request: { params: z.object({ id: z.string().openapi({ param: { name: "id", in: "path" } }) }) },
  responses: { 204: noContent, ...errors(401, 403, 404) },
});
