import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, noContent, signedIn } from "./http.ts";
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

export const EnvironmentStore = z
  .object({
    store: z.string(),
    access: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("aws_role"),
        roleArn: z.string(),
        externalId: z.string(),
        region: z.string(),
      }),
      z.object({
        type: z.literal("keys"),
        accessKeyId: z.string(),
        endpoint: z.string().nullable(),
        region: z.string(),
      }),
    ]),
    verified: Time.nullable(),
  })
  .openapi("EnvironmentStore");

export const Environment = z
  .object({
    name: z.string(),
    created: Time,
    store: EnvironmentStore.nullable().openapi({
      description: "Your bucket, when the environment keeps its data there. Null: the server's.",
    }),
  })
  .openapi("Environment");

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

export const EnvironmentParams = z.object({
  environment: z.string().openapi({ param: { name: "environment", in: "path" }, example: "prod" }),
});

export const StoreAccess = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("aws_role"),
      roleArn: z.string().regex(/^arn:aws[\w-]*:iam::\d{12}:role\/.+$/, "an IAM role ARN"),
      region: z.string().min(1).openapi({ example: "us-east-1" }),
    }),
    z.object({
      type: z.literal("keys"),
      accessKeyId: z.string().min(1),
      secretAccessKey: z.string().min(1).openapi({ description: "Kept sealed; never shown again." }),
      endpoint: z.url().optional().openapi({
        description: "An S3 compatible endpoint, such as R2's or MinIO's. AWS when not given.",
      }),
      region: z.string().min(1).default("auto"),
    }),
  ])
  .openapi("StoreAccess");

export const NewEnvironmentStore = z
  .object({
    store: z
      .string()
      .regex(/^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](\/[^?]*)?$/, "an s3://bucket/prefix")
      .openapi({ example: "s3://acme-data/skywake" }),
    access: StoreAccess,
  })
  .openapi("NewEnvironmentStore");

export const StoreTrust = z
  .object({
    principal: z.string().nullable().openapi({
      description: "The AWS principal to trust in the role's trust policy.",
    }),
    externalId: z.string().openapi({ description: "The external ID the trust policy must require." }),
  })
  .openapi("StoreTrust");

export const getStoreTrust = createRoute({
  method: "get",
  path: "/environments/{environment}/store/trust",
  operationId: "getStoreTrust",
  tags: ["environments"],
  summary: "What a role must trust before an environment can keep its data in your bucket.",
  security: signedIn,
  request: { params: EnvironmentParams },
  responses: { 200: json(StoreTrust, "The trust to grant."), ...errors(401, 403) },
});

export const setEnvironmentStore = createRoute({
  method: "put",
  path: "/environments/{environment}/store",
  operationId: "setEnvironmentStore",
  tags: ["environments"],
  summary:
    "Keeps the environment's data in your own bucket. The API checks it can write, list and " +
    "delete there first. Only while the environment holds no namespaces or indexes.",
  security: signedIn,
  request: { params: EnvironmentParams, body: body(NewEnvironmentStore) },
  responses: {
    200: json(EnvironmentStore, "The bucket, checked."),
    ...errors(400, 401, 403, 404, 409, 501),
  },
});

export const removeEnvironmentStore = createRoute({
  method: "delete",
  path: "/environments/{environment}/store",
  operationId: "removeEnvironmentStore",
  tags: ["environments"],
  summary: "Goes back to the server's regions. Only while the environment holds no data.",
  security: signedIn,
  request: { params: EnvironmentParams },
  responses: { 204: noContent, ...errors(401, 403, 404, 409) },
});
