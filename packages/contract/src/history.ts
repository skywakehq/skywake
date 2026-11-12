import { createRoute } from "@hono/zod-openapi";

import { Committed } from "./files.ts";
import { body, count, errors, json, orDefault, page, signedIn, signedInOrPublic } from "./http.ts";
import { BranchParams, ErrorFields, Hash, Name, NamespaceParams, z } from "./schemas.ts";

export const CommitInfo = z
  .object({
    hash: z.string(),
    message: z.string(),
    time: z.number().int().openapi({ description: "Seconds since the Unix epoch." }),
    session: z.string().nullable(),
    merged: z
      .string()
      .nullable()
      .openapi({ description: "For a merge: the commit that was merged in." }),
  })
  .openapi("CommitInfo");

export const Changed = z
  .object({
    kind: z.enum(["added", "removed", "modified"]),
    path: z
      .string()
      .openapi({ description: "A new or removed folder is one change, not one per file." }),
  })
  .openapi("Changed");

export const FeedItem = CommitInfo.extend({ changes: z.array(Changed) }).openapi("FeedItem");

export const FileVersion = CommitInfo.extend({
  size: z
    .number()
    .int()
    .nullable()
    .openapi({ description: "The file's size after this commit. Null if the commit deleted it." }),
}).openapi("FileVersion");

export const listCommits = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}/commits",
  operationId: "listCommits",
  tags: ["history"],
  summary: "Commits on the branch, newest first.",
  security: signedInOrPublic,
  request: {
    params: BranchParams,
    query: z.object({ limit: count("The most commits to return. 50 by default.") }),
  },
  responses: { 200: json(z.array(CommitInfo), "The commits."), ...errors(401, 403, 404) },
});

export const listChanges = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}/changes",
  operationId: "listChanges",
  tags: ["history"],
  summary: "What each commit since `since` changed, oldest first. Poll it with the last hash seen.",
  security: signedInOrPublic,
  request: {
    params: BranchParams,
    query: z.object({
      since: Hash.optional().openapi({
        description: "The last commit seen. Without it, the newest commits.",
      }),
      limit: count("The most commits to return. 50 by default."),
    }),
  },
  responses: {
    200: json(z.array(FeedItem), "The commits and their changes."),
    ...errors(400, 401, 403, 404),
  },
});

export const fileHistory = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}/files/history",
  operationId: "fileHistory",
  tags: ["history"],
  summary: "The versions of one file, newest first. Read one with `files/content?at=<hash>`.",
  security: signedInOrPublic,
  request: {
    params: BranchParams,
    query: z.object({ path: z.string().min(1).max(4096), ...page("versions", "hash") }),
  },
  responses: { 200: json(z.array(FileVersion), "The versions."), ...errors(400, 401, 403, 404) },
});

export const diffBranches = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}/diff",
  operationId: "diffBranches",
  tags: ["history"],
  summary: "What changed from the branch `from` to this one, in path order.",
  security: signedInOrPublic,
  request: {
    params: BranchParams,
    query: z.object({
      from: Name,
      against: orDefault(z.enum(["head", "base"]), "head").openapi({
        description:
          "`head` compares with `from` as it is now. `base` compares with the newest commit both " +
          "branches share, so only what this branch changed shows, as in `git diff from...branch`.",
      }),
      ...page("changes", "path"),
    }),
  },
  responses: {
    200: json(z.array(Changed), "The changes."),
    ...errors(400, 401, 403, 404),
  },
});

const commitOptions = {
  message: z.string().min(1).max(10_000).optional(),
  session: z
    .string()
    .optional()
    .openapi({ description: "The session making the change. The commit records it." }),
};

export const NewRevert = z
  .object({
    commit: Hash.openapi({ description: "The commit to undo." }),
    ...commitOptions,
  })
  .openapi("NewRevert");

export const RevertConflict = z
  .object({
    conflicts: z
      .array(z.string())
      .openapi({ description: "Paths the commit changed that later commits changed again." }),
    ...ErrorFields,
  })
  .openapi("RevertConflict");

export const revertCommit = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/branches/{branch}/revert",
  operationId: "revertCommit",
  tags: ["history"],
  summary: "Undoes one commit with a new commit that puts back what it changed.",
  description:
    "The commit's paths return to how they were in its parent; for a merge, its first parent. " +
    "If the branch changed any of those paths since, nothing is saved and the answer is 409.",
  security: signedIn,
  request: { params: BranchParams, body: body(NewRevert) },
  responses: {
    201: json(Committed, "The new commit."),
    200: json(Committed, "The commit changed nothing, so no commit was made."),
    409: json(RevertConflict, "The branch changed the same paths since. Nothing was saved."),
    ...errors(400, 401, 403, 404),
  },
});

export const NewReset = z
  .object({
    to: Hash.openapi({ description: "The commit whose files the branch should have." }),
    ...commitOptions,
  })
  .openapi("NewReset");

export const resetBranch = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/branches/{branch}/reset",
  operationId: "resetBranch",
  tags: ["history"],
  summary: "Makes the branch's files what they were at a commit, as one new commit.",
  description:
    "The history stays: the new commit is on top of the head. The commit may be from any branch " +
    "of the namespace.",
  security: signedIn,
  request: { params: BranchParams, body: body(NewReset) },
  responses: {
    201: json(Committed, "The new commit."),
    200: json(Committed, "The files already match, so no commit was made."),
    ...errors(400, 401, 403, 404, 409),
  },
});

export const Resolution = z
  .object({
    path: z.string().min(1).max(4096),
    take: z.enum(["ours", "theirs"]).optional().openapi({
      description: "`ours`: the path as it is on `into`. `theirs`: as it is on `from`.",
    }),
    text: z.string().optional().openapi({ description: "New content, as text." }),
    base64: z.base64().optional().openapi({ description: "New content, as base64." }),
    parts: z
      .array(z.string().regex(/^[0-9a-f]{64}$/, "not a part hash"))
      .min(1)
      .max(10_000)
      .optional()
      .openapi({ description: "New content: uploaded parts, in order." }),
    delete: orDefault(z.boolean(), false).openapi({ description: "Leaves the path out." }),
    executable: orDefault(z.boolean(), false),
  })
  .refine(
    (resolution) =>
      [
        resolution.take !== undefined,
        resolution.text !== undefined,
        resolution.base64 !== undefined,
        resolution.parts !== undefined,
        resolution.delete === true,
      ].filter(Boolean).length === 1,
    { message: "give one of take, text, base64, parts or delete" },
  )
  .openapi("Resolution", {
    description:
      "What one conflicting path becomes. Give exactly one of `take`, `text`, `base64`, `parts` or `delete`.",
  });

export const NewMerge = z
  .object({
    from: Name.openapi({ description: "The branch to merge in." }),
    into: Name.openapi({ description: "The branch that receives the merge. It may be protected." }),
    message: z.string().min(1).max(10_000).optional(),
    session: z
      .string()
      .optional()
      .openapi({ description: "The session doing the merge. The merge commit records it." }),
    dry_run: orDefault(z.boolean(), false).openapi({
      description: "Only report the conflicts a merge would have now, less those `resolve` covers.",
    }),
    resolve: z
      .array(Resolution)
      .max(10_000)
      .optional()
      .openapi({
        description:
          "How to settle conflicts, by path. A path's resolution also settles the conflicts inside " +
          "it. With every conflict covered, the merge lands as one merge commit with both parents.",
      }),
  })
  .openapi("NewMerge");

export const MergeResult = z
  .object({
    head: z
      .string()
      .nullable()
      .openapi({ description: "The new head of `into`, when the merge landed." }),
    conflicts: z
      .array(z.string())
      .openapi({ description: "Paths changed on both sides in ways that do not combine." }),
  })
  .openapi("MergeResult");

export const MergeConflict = MergeResult.extend(ErrorFields).openapi("MergeConflict");

export const mergeBranches = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/merges",
  operationId: "mergeBranches",
  tags: ["history"],
  summary: "Merges one branch into another. Merges into the same branch run one at a time.",
  description:
    "A merge with conflicts saves nothing and answers 409 with the paths. To finish it, send " +
    "the merge again with `resolve` covering them.",
  security: signedIn,
  request: { params: NamespaceParams, body: body(NewMerge) },
  responses: {
    200: json(MergeResult, "The merge landed, or the dry run's conflicts."),
    409: json(MergeConflict, "The merge conflicts. Nothing was saved."),
    ...errors(400, 401, 403, 404),
  },
});
