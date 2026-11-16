import { createRoute, z } from "@hono/zod-openapi";

import { FileChange } from "../files.ts";
import { Visibility } from "../schemas.ts";
import {
  AtQuery,
  Branch,
  BranchName,
  BranchQuery,
  body,
  bytes,
  DiskParams,
  done,
  errors,
  json,
  listOf,
  Merge,
  NewBranch,
  PageQuery,
  security,
  ShortName,
  Time,
} from "./common.ts";

const tags = ["disks"];

export const Disk = z
  .object({ name: z.string(), region: z.string(), visibility: Visibility, created: Time })
  .openapi("Disk");

export const DiskInfo = Disk.extend({
  search: z.boolean().openapi({ description: "Whether `query` searches the files by meaning." }),
  branches: z.array(z.string()),
}).openapi("DiskInfo");

export const NewDisk = z
  .object({
    name: ShortName.openapi({ example: "app" }),
    region: z.string().optional(),
    visibility: Visibility.optional(),
    search: z.boolean().optional().openapi({
      description: "Index the files for `query`. On by default when the environment has a model.",
    }),
  })
  .openapi("NewDisk");

export const DiskSettings = z
  .object({ visibility: Visibility.optional(), search: z.boolean().optional() })
  .openapi("DiskSettings");

export const Entry = z
  .object({
    path: z.string(),
    kind: z.enum(["file", "folder", "symlink"]),
    size: z.number().int(),
    modified: Time.nullable(),
  })
  .openapi("Entry");

export const Committed = z
  .object({
    commit: z.string().openapi({ description: "The branch's newest commit after the call." }),
    changed: z.boolean().openapi({
      description: "False when nothing differed from what was there, so no commit was made.",
    }),
  })
  .openapi("CommittedV2");

export const NewCommit = z
  .object({
    message: z.string().min(1).max(10_000).optional(),
    changes: z.array(FileChange).min(1).max(10_000),
    ...BranchQuery,
  })
  .openapi("NewCommitV2");

export const Commit = z
  .object({
    id: z.string(),
    message: z.string(),
    created: Time,
    merged: z.string().nullable(),
  })
  .openapi("Commit");

export const Change = z
  .object({ path: z.string(), change: z.enum(["added", "removed", "modified"]) })
  .openapi("Change");

export const Match = z
  .object({ path: z.string(), line: z.number().int(), text: z.string() })
  .openapi("MatchV2");

export const Found = z
  .object({ path: z.string(), kind: z.enum(["file", "folder", "symlink"]), size: z.number().int() })
  .openapi("Found");

export const FileHit = z
  .object({ path: z.string(), score: z.number(), snippet: z.string() })
  .openapi("FileHit");

export const Grep = z
  .object({
    pattern: z.string().min(1).max(1000),
    path: z.string().max(4096).optional(),
    glob: z.string().min(1).max(1000).optional(),
    ignore_case: z.boolean().optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
    ...BranchQuery,
    ...AtQuery,
  })
  .openapi("Grep");

export const Find = z
  .object({
    glob: z.string().min(1).max(1000),
    path: z.string().max(4096).optional(),
    kind: z.enum(["any", "files", "folders"]).optional(),
    limit: z.number().int().min(1).max(100_000).optional(),
    ...BranchQuery,
    ...AtQuery,
  })
  .openapi("Find");

export const DiskQuery = z
  .object({
    text: z.string().min(1).max(4096),
    limit: z.number().int().min(1).max(100).optional(),
    path: z.string().max(4096).optional(),
    ...BranchQuery,
  })
  .openapi("DiskQuery");

export const Revert = z
  .object({ commit: z.string(), message: z.string().min(1).max(10_000).optional(), ...BranchQuery })
  .openapi("Revert");

export const RestoreDisk = z
  .object({ to: z.string().openapi({ description: "A commit." }), ...BranchQuery })
  .openapi("RestoreDisk");

export const DiskMerge = Merge.extend({
  message: z.string().min(1).max(10_000).optional(),
  dry_run: z.boolean().optional(),
  prefer: z.enum(["ours", "theirs"]).optional().openapi({
    description: "Settle every conflict by keeping `into`'s side (`ours`) or `from`'s (`theirs`).",
  }),
}).openapi("DiskMerge");

export const DiskMerged = z
  .object({ commit: z.string().nullable(), conflicts: z.array(z.string()) })
  .openapi("DiskMerged");

export const Uploaded = z.object({ part: z.string(), size: z.number().int() }).openapi("Uploaded");

const fileParams = DiskParams.extend({
  path: z.string().openapi({ param: { name: "path", in: "path" }, example: "src/main.rs" }),
});
const branchParams = DiskParams.extend({
  branch: BranchName.openapi({ param: { name: "branch", in: "path" }, example: "agent-1" }),
});

const route = <T extends Parameters<typeof createRoute>[0]>(r: T) =>
  createRoute({ tags, security, ...r });

export const listDisks = route({
  method: "get",
  path: "/disks",
  operationId: "listDisks",
  request: { query: z.object(PageQuery) },
  responses: { 200: json(listOf(Disk, "DiskList"), "The disks.") },
});

export const createDisk = route({
  method: "post",
  path: "/disks",
  operationId: "createDisk",
  summary: "Makes a disk with settings chosen up front. Writing to a new name also makes one.",
  request: { body: body(NewDisk) },
  responses: { 201: json(DiskInfo, "The disk."), ...errors(400, 402, 403, 409) },
});

export const getDisk = route({
  method: "get",
  path: "/disks/{disk}",
  operationId: "getDisk",
  request: { params: DiskParams },
  responses: { 200: json(DiskInfo, "The disk."), ...errors(403, 404) },
});

export const configureDisk = route({
  method: "patch",
  path: "/disks/{disk}",
  operationId: "configureDisk",
  request: { params: DiskParams, body: body(DiskSettings) },
  responses: { 200: json(DiskInfo, "The disk."), ...errors(400, 403, 404) },
});

export const destroyDisk = route({
  method: "delete",
  path: "/disks/{disk}",
  operationId: "destroyDisk",
  request: { params: DiskParams },
  responses: { 204: done, ...errors(403, 404) },
});

export const listFiles = route({
  method: "get",
  path: "/disks/{disk}/files",
  operationId: "listFiles",
  request: {
    params: DiskParams,
    query: z.object({
      path: z
        .string()
        .max(4096)
        .optional()
        .openapi({ description: "A folder; the root by default." }),
      recursive: z.enum(["true", "false"]).optional(),
      ...BranchQuery,
      ...AtQuery,
      ...PageQuery,
    }),
  },
  responses: { 200: json(listOf(Entry, "EntryList"), "In path order."), ...errors(400, 403, 404) },
});

export const readFile = route({
  method: "get",
  path: "/disks/{disk}/files/{path}",
  operationId: "readFile",
  request: {
    params: fileParams,
    query: z.object({
      offset: z.coerce.number().int().min(0).optional(),
      length: z.coerce.number().int().min(0).optional(),
      ...BranchQuery,
      ...AtQuery,
    }),
  },
  responses: {
    200: { content: bytes.content, description: "The bytes." },
    ...errors(400, 403, 404),
  },
});

export const writeFile = route({
  method: "put",
  path: "/disks/{disk}/files/{path}",
  operationId: "writeFile",
  summary: "Writes one file as one commit. Makes the disk if it is missing.",
  request: {
    params: fileParams,
    query: z.object({ message: z.string().max(10_000).optional(), ...BranchQuery }),
    body: bytes,
  },
  responses: { 200: json(Committed, "The commit."), ...errors(400, 402, 403, 409, 413) },
});

export const deleteFile = route({
  method: "delete",
  path: "/disks/{disk}/files/{path}",
  operationId: "deleteFile",
  request: {
    params: fileParams,
    query: z.object({ message: z.string().max(10_000).optional(), ...BranchQuery }),
  },
  responses: { 200: json(Committed, "The commit."), ...errors(403, 404, 409) },
});

export const commit = route({
  method: "post",
  path: "/disks/{disk}/commits",
  operationId: "commit",
  summary: "Many changes as one commit. All land, or none. Makes the disk if it is missing.",
  request: { params: DiskParams, body: body(NewCommit) },
  responses: { 200: json(Committed, "The commit."), ...errors(400, 402, 403, 409) },
});

export const log = route({
  method: "get",
  path: "/disks/{disk}/commits",
  operationId: "log",
  request: {
    params: DiskParams,
    query: z.object({ path: z.string().max(4096).optional(), ...BranchQuery, ...PageQuery }),
  },
  responses: { 200: json(listOf(Commit, "CommitList"), "Newest first."), ...errors(403, 404) },
});

export const diff = route({
  method: "get",
  path: "/disks/{disk}/diff",
  operationId: "diff",
  summary: "What `branch` changed compared with `against`, in path order.",
  request: {
    params: DiskParams,
    query: z.object({ against: BranchName, ...BranchQuery, ...PageQuery }),
  },
  responses: { 200: json(listOf(Change, "ChangeList"), "The changes."), ...errors(400, 403, 404) },
});

export const grep = route({
  method: "post",
  path: "/disks/{disk}/grep",
  operationId: "grep",
  request: { params: DiskParams, body: body(Grep) },
  responses: { 200: json(listOf(Match, "MatchList"), "The lines."), ...errors(400, 403, 404) },
});

export const find = route({
  method: "post",
  path: "/disks/{disk}/find",
  operationId: "find",
  request: { params: DiskParams, body: body(Find) },
  responses: { 200: json(listOf(Found, "FoundList"), "The paths."), ...errors(400, 403, 404) },
});

export const queryDisk = route({
  method: "post",
  path: "/disks/{disk}/query",
  operationId: "queryDisk",
  summary: "Finds files by meaning and keywords.",
  request: { params: DiskParams, body: body(DiskQuery) },
  responses: {
    200: json(listOf(FileHit, "FileHitList"), "Best first."),
    ...errors(400, 403, 404, 409),
  },
});

export const revert = route({
  method: "post",
  path: "/disks/{disk}/revert",
  operationId: "revert",
  request: { params: DiskParams, body: body(Revert) },
  responses: { 200: json(Committed, "The commit."), ...errors(400, 403, 404, 409) },
});

export const restoreDisk = route({
  method: "post",
  path: "/disks/{disk}/restore",
  operationId: "restoreDisk",
  request: { params: DiskParams, body: body(RestoreDisk) },
  responses: { 200: json(Committed, "The commit."), ...errors(400, 403, 404) },
});

export const upload = route({
  method: "post",
  path: "/disks/{disk}/uploads",
  operationId: "upload",
  summary: "Uploads up to 16 MiB of a large file, for a commit's `parts`.",
  request: { params: DiskParams, body: bytes },
  responses: { 201: json(Uploaded, "The part."), ...errors(400, 403, 404, 413) },
});

export const listDiskBranches = route({
  method: "get",
  path: "/disks/{disk}/branches",
  operationId: "listDiskBranches",
  request: { params: DiskParams, query: z.object(PageQuery) },
  responses: { 200: json(listOf(Branch, "DiskBranchList"), "The branches."), ...errors(403, 404) },
});

export const forkDisk = route({
  method: "post",
  path: "/disks/{disk}/branches",
  operationId: "forkDisk",
  request: { params: DiskParams, body: body(NewBranch) },
  responses: { 201: json(Branch, "The new branch."), ...errors(400, 403, 404, 409) },
});

export const destroyDiskBranch = route({
  method: "delete",
  path: "/disks/{disk}/branches/{branch}",
  operationId: "destroyDiskBranch",
  request: { params: branchParams },
  responses: { 204: done, ...errors(403, 404, 409) },
});

export const mergeDisk = route({
  method: "post",
  path: "/disks/{disk}/merges",
  operationId: "mergeDisk",
  summary: "Brings `from` into `into`. Conflicts answer 409 and list the paths.",
  request: { params: DiskParams, body: body(DiskMerge) },
  responses: { 200: json(DiskMerged, "Merged."), ...errors(400, 403, 404, 409) },
});

export const routes = [
  listDisks,
  createDisk,
  getDisk,
  configureDisk,
  destroyDisk,
  listFiles,
  readFile,
  writeFile,
  deleteFile,
  commit,
  log,
  diff,
  grep,
  find,
  queryDisk,
  revert,
  restoreDisk,
  upload,
  listDiskBranches,
  forkDisk,
  destroyDiskBranch,
  mergeDisk,
];
