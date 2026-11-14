import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, noContent, signedIn } from "./http.ts";
import { BranchParams, Name, NamespaceParams, Time, z } from "./schemas.ts";

export const MAX_BYTES_DEFAULT = 1 << 20;

export const NewIndexLink = z
  .object({
    index: Name.openapi({
      example: "prod/app-files",
      description:
        "The index to keep up with the files. Made when missing, with `path` and `text` " +
        "attributes; an existing one must have both.",
    }),
    include: z
      .array(z.string().min(1).max(256))
      .max(64)
      .default([])
      .openapi({ description: "Globs of paths to index, such as `src/**`. All when empty." }),
    exclude: z
      .array(z.string().min(1).max(256))
      .max(64)
      .default([])
      .openapi({ description: "Globs of paths never to index, such as `node_modules/**`." }),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(4 << 20)
      .default(MAX_BYTES_DEFAULT)
      .openapi({ description: "Larger files are left out. 1 MiB when not given." }),
    embed: z
      .object({
        model: z.string().min(1),
        dims: z.number().int().min(1).max(4096),
      })
      .optional()
      .openapi({
        description:
          "Also embed each file (its first 8,000 characters) for vector search, when the " +
          "index is made. Billed as embeddings.",
      }),
  })
  .openapi("NewIndexLink");

export const LinkedBranch = z
  .object({
    branch: z.string(),
    synced: z.string().nullable().openapi({ description: "The commit the index matches." }),
    behind: z.boolean().openapi({ description: "Whether newer files wait to be indexed." }),
    syncedAt: Time.nullable(),
    error: z.string().nullable().openapi({ description: "Why the last try failed, if it did." }),
  })
  .openapi("LinkedBranch");

export const IndexLink = z
  .object({
    namespace: z.string(),
    index: z.string(),
    include: z.array(z.string()),
    exclude: z.array(z.string()),
    maxBytes: z.number().int(),
    created: Time,
    branches: z.array(LinkedBranch),
  })
  .openapi("IndexLink");

export const BranchIndex = LinkedBranch.extend({
  head: z.string().openapi({ description: "The branch's head now." }),
  version: z
    .string()
    .nullable()
    .openapi({ description: "The index version that matches `synced`." }),
}).openapi("BranchIndex");

export const linkIndex = createRoute({
  method: "put",
  path: "/namespaces/{namespace}/index",
  operationId: "linkIndex",
  tags: ["links"],
  summary:
    "Keeps an index up with the namespace's files: `main` now, and branches forked with " +
    "`withIndex`. Each save is indexed within about 30 seconds; a commit at once.",
  security: signedIn,
  request: { params: NamespaceParams, body: body(NewIndexLink) },
  responses: { 200: json(IndexLink, "The link."), ...errors(400, 401, 402, 403, 404, 409) },
});

export const getIndexLink = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/index",
  operationId: "getIndexLink",
  tags: ["links"],
  security: signedIn,
  request: { params: NamespaceParams },
  responses: { 200: json(IndexLink, "The link."), ...errors(401, 403, 404) },
});

export const unlinkIndex = createRoute({
  method: "delete",
  path: "/namespaces/{namespace}/index",
  operationId: "unlinkIndex",
  tags: ["links"],
  summary: "Stops indexing the files. The index and what it holds stay.",
  security: signedIn,
  request: { params: NamespaceParams },
  responses: { 204: noContent, ...errors(401, 403, 404) },
});

export const getBranchIndex = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}/index",
  operationId: "getBranchIndex",
  tags: ["links"],
  summary: "How far the branch's index is behind its files.",
  security: signedIn,
  request: { params: BranchParams },
  responses: { 200: json(BranchIndex, "The branch's index."), ...errors(401, 403, 404) },
});

export const branchAdvanced = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/branches/{branch}/advanced",
  operationId: "branchAdvanced",
  tags: ["links"],
  summary:
    "Tells the API a branch moved without it, such as a save written straight to the " +
    "bucket. Cheap and safe to repeat; an unlinked branch ignores it.",
  security: signedIn,
  request: { params: BranchParams },
  responses: { 202: { description: "Noted." }, ...errors(401, 403, 404) },
});
