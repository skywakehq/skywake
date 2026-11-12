import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, signedIn } from "./http.ts";
import { NamespaceParams, Time, z } from "./schemas.ts";

export const Access = z.enum(["read", "write"]).openapi("Access");

export const CredentialsRequest = z
  .object({
    access: Access.openapi({ description: "`write` needs a key with the `write` role." }),
  })
  .openapi("CredentialsRequest");

export const StoreCredentials = z
  .object({
    store: z.string().openapi({
      description: "The namespace's folder in the bucket, as `s3://<bucket>/<prefix>`.",
      example: "s3://skywake/org_1/ns_2",
    }),
    region: z.string(),
    endpoint: z
      .string()
      .nullable()
      .openapi({ description: "The S3 endpoint, for S3-compatible stores. Null for AWS." }),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    sessionToken: z.string(),
    expiresAt: Time.openapi({ description: "Ask again before then. At least 15 minutes ahead." }),
    access: Access,
    heads: z
      .object({
        nodes: z.array(z.string()).openapi({ description: "The cache servers that own branch heads." }),
        folder: z.string().openapi({ description: "The namespace's folder, as the cache servers name it." }),
        pass: z.string().openapi({
          description: "Sent as the bearer token. Good until `expiresAt`, for this folder and access only.",
        }),
      })
      .nullable()
      .openapi({
        description:
          "When the cache servers own this namespace's branch heads: change heads through them. " +
          "These credentials then cannot write `refs/`.",
      }),
  })
  .openapi("StoreCredentials");

export const createCredentials = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/credentials",
  operationId: "createCredentials",
  tags: ["namespaces"],
  summary:
    "Short-lived S3 credentials that reach only this namespace's folder, so a daemon or CLI " +
    "can use the store directly without a key for the whole bucket.",
  security: signedIn,
  request: { params: NamespaceParams, body: body(CredentialsRequest) },
  responses: {
    200: json(StoreCredentials, "The credentials."),
    ...errors(400, 401, 403, 404, 501),
  },
});
