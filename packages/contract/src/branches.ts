import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, noContent, page, signedIn, signedInOrPublic } from "./http.ts";
import { BranchParams, Hash, Name, NamespaceParams, Time, z } from "./schemas.ts";

export const Branch = z
  .object({
    name: z.string(),
    forked_from: z.string().nullable(),
    protected: z.boolean().openapi({ description: "A protected branch changes only by merge." }),
    created: Time,
  })
  .openapi("Branch");

export const BranchInfo = Branch.extend({
  head: z.string().openapi({ description: "The commit the branch points to." }),
  base: z
    .string()
    .nullable()
    .openapi({
      description:
        "The newest commit this branch shares with `forked_from`: where it forked, or where the " +
        "two last merged. What the branch changed since is `diff?from=<forked_from>&against=base`. " +
        "Null for an empty branch, or once `forked_from` is deleted.",
    }),
}).openapi("BranchInfo");

export const NewBranch = z
  .object({
    name: Name.openapi({ example: "agents/fix-1" }),
    from: Name.optional().openapi({
      description: "The branch to fork. Without it, the new branch is empty.",
    }),
    at: Hash.optional().openapi({
      description: "Fork this older commit of `from` instead of its head.",
    }),
    withIndex: z.boolean().optional().openapi({
      description:
        "Also fork the linked index, from its version that matches the fork's commit, and keep " +
        "it up with this branch. Needs `from` and a namespace with a linked index.",
    }),
  })
  .openapi("NewBranch");

export const Head = z.object({ head: z.string() }).openapi("Head");

export const BranchUpdate = z
  .object({
    protected: z
      .boolean()
      .openapi({ description: "A protected branch changes only by merge, and cannot be deleted." }),
  })
  .openapi("BranchUpdate");

export const listBranches = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches",
  operationId: "listBranches",
  tags: ["branches"],
  summary: "The branches, in name order.",
  security: signedInOrPublic,
  request: { params: NamespaceParams, query: z.object(page("branches", "name")) },
  responses: { 200: json(z.array(Branch), "The branches."), ...errors(401, 403, 404) },
});

export const createBranch = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/branches",
  operationId: "createBranch",
  tags: ["branches"],
  summary: "Forks a branch, or makes an empty one. A fork copies no data.",
  security: signedIn,
  request: { params: NamespaceParams, body: body(NewBranch) },
  responses: { 201: json(Head, "The new branch's head."), ...errors(400, 401, 403, 404, 409) },
});

export const getBranch = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}",
  operationId: "getBranch",
  tags: ["branches"],
  security: signedInOrPublic,
  request: { params: BranchParams },
  responses: { 200: json(BranchInfo, "The branch."), ...errors(401, 403, 404) },
});

export const updateBranch = createRoute({
  method: "patch",
  path: "/namespaces/{namespace}/branches/{branch}",
  operationId: "updateBranch",
  tags: ["branches"],
  summary: "Protects a branch, or stops protecting it.",
  description:
    "Protecting answers once the API writes allowed before have ended; if they run for over " +
    "two minutes it answers 503, and the branch stays protected. Store credentials minted " +
    "before keep their access until they expire (900 seconds by default), so protection " +
    "reaches them only then.",
  security: signedIn,
  request: { params: BranchParams, body: body(BranchUpdate) },
  responses: { 204: noContent, ...errors(400, 401, 403, 404, 503) },
});

export const deleteBranch = createRoute({
  method: "delete",
  path: "/namespaces/{namespace}/branches/{branch}",
  operationId: "deleteBranch",
  tags: ["branches"],
  summary: "Deletes a branch. Its data stays until garbage collection.",
  description:
    "Fails with 409 if the branch moves while it is being deleted, as when a mount is saving to it.",
  security: signedIn,
  request: { params: BranchParams },
  responses: { 204: noContent, ...errors(401, 403, 404, 409) },
});
