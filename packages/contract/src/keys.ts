import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, noContent, signedIn } from "./http.ts";
import { EnvironmentName, NamePattern, NamespacePattern, Role, Time, z } from "./schemas.ts";

export const Key = z
  .object({
    id: z.string(),
    name: z.string(),
    role: Role,
    environment: z.string().nullable().openapi({
      description: "The environment the key works in. Null for a key that works in every one.",
    }),
    only: z.array(z.string()).openapi({
      description:
        "Which disks in its environment it reaches: names, prefixes ending in `*`, " +
        "or `*` for all.",
    }),
    namespaces: z.string().openapi({
      description:
        "Deprecated: the same reach as one pattern of full names. Use `environment` and `only`.",
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
    environment: EnvironmentName.nullable()
      .optional()
      .openapi({
        description:
          "The environment it works in. A key made by a key of one environment gets that one. " +
          "Null makes a key for every environment, which only an organization admin may make.",
      }),
    only: z
      .array(NamePattern)
      .min(1)
      .max(50)
      .optional()
      .openapi({
        description:
          "Which disks in its environment it reaches: names, prefixes ending in `*`, " +
          "or `*` for all, the default.",
      }),
    namespaces: NamespacePattern.optional().openapi({
      description:
        "Deprecated: one pattern of full names, such as `prod/*`. Use `environment` and `only`.",
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

export const Whoami = z
  .object({
    organization: z.string(),
    environment: z
      .string()
      .nullable()
      .openapi({
        description:
          "The environment requests work in: the key's own, or the `Skywake-Environment` header " +
          "for a key or person that may use every environment. Null when neither says.",
      }),
    role: Role,
    only: z.array(z.string()),
    key: z.string().nullable().openapi({ description: "The key's id, when a key is used." }),
    user: z.string().nullable().openapi({ description: "The person, when the console calls." }),
    email: z.string().nullable(),
    expires: Time.nullable(),
  })
  .openapi("Whoami");

export const whoami = createRoute({
  method: "get",
  path: "/whoami",
  operationId: "whoami",
  tags: ["keys"],
  summary: "Who is calling: the organization, environment and role the key or person has.",
  security: signedIn,
  responses: { 200: json(Whoami, "The caller."), ...errors(401, 403) },
});
