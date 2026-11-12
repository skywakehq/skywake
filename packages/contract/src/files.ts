import { createRoute } from "@hono/zod-openapi";

import { body, count, errors, json, orDefault, page, signedIn, signedInOrPublic } from "./http.ts";
import { BranchParams, ErrorBody, Hash, NamespaceParams, z } from "./schemas.ts";

const at = Hash.optional().openapi({
  description: "Read an older commit of the branch instead of its head.",
});

export const FileInfo = z
  .object({
    name: z.string(),
    kind: z.enum(["file", "folder", "symlink"]),
    size: z.number().int().openapi({ description: "Bytes, for a file." }),
    executable: z.boolean(),
    target: z.string().optional().openapi({ description: "Where a symlink points." }),
    modified: z.number().int().openapi({
      description: "When a file last changed, in milliseconds since 1970. 0 otherwise.",
    }),
  })
  .openapi("FileInfo");

export const Listing = FileInfo.extend({
  entries: z
    .array(FileInfo)
    .openapi({ description: "What a folder holds, in name order. Empty for anything else." }),
}).openapi("Listing");

export const listFiles = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}/files",
  operationId: "listFiles",
  tags: ["files"],
  summary: "Describes a path. For a folder, also lists what it holds.",
  security: signedInOrPublic,
  request: {
    params: BranchParams,
    query: z.object({
      path: z
        .string()
        .max(4096)
        .default("")
        .openapi({ description: "Such as `src/main.rs`. The root by default." }),
      at,
      ...page("entries of a folder", "name"),
    }),
  },
  responses: { 200: json(Listing, "The path."), ...errors(400, 401, 403, 404) },
});

export const readFile = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}/files/content",
  operationId: "readFile",
  tags: ["files"],
  summary: "Reads a file, or a byte range of it. Only the chunks in the range are fetched.",
  security: signedInOrPublic,
  request: {
    params: BranchParams,
    query: z.object({
      path: z.string().max(4096),
      offset: z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .openapi({ description: "The first byte to read." }),
      length: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .openapi({ description: "The most bytes to read. The rest by default." }),
      at,
    }),
  },
  responses: {
    200: {
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
      description: "The bytes.",
    },
    ...errors(400, 401, 403, 404),
  },
});

export const Match = z
  .object({
    path: z.string(),
    line: z.number().int().openapi({ description: "Starts at 1." }),
    text: z.string(),
  })
  .openapi("Match");

export const searchFiles = createRoute({
  method: "get",
  path: "/namespaces/{namespace}/branches/{branch}/search",
  operationId: "searchFiles",
  tags: ["files"],
  summary:
    "Finds lines that match a regular expression, like `grep -rn`. Skips binary files and files over 1 MiB.",
  security: signedInOrPublic,
  request: {
    params: BranchParams,
    query: z.object({
      pattern: z.string().min(1).max(1000),
      path: z
        .string()
        .max(4096)
        .default("")
        .openapi({ description: "Search only under this folder." }),
      limit: count("The most matches to return. 100 by default."),
    }),
  },
  responses: { 200: json(z.array(Match), "The matches."), ...errors(400, 401, 403, 404) },
});

export const FileChange = z
  .object({
    path: z.string().min(1).max(4096),
    text: z.string().optional().openapi({ description: "The new content, as text." }),
    base64: z.base64().optional().openapi({ description: "The new content, as base64." }),
    parts: z
      .array(z.string().regex(/^[0-9a-f]{64}$/, "not a part hash"))
      .min(1)
      .max(10_000)
      .optional()
      .openapi({ description: "The new content: uploaded parts, in order." }),
    from: z
      .object({
        path: z.string().max(4096),
        at: Hash.optional().openapi({
          description: "Copy from this commit. By default, from the branch before this commit.",
        }),
      })
      .optional()
      .openapi({
        description:
          "Copies the file, folder or symlink at `path`, without copying data. With a delete of " +
          "`path` in the same commit, this is a move.",
      }),
    folder: orDefault(z.boolean(), false).openapi({
      description: "Makes an empty folder, unless a folder is already there.",
    }),
    delete: orDefault(z.boolean(), false).openapi({ description: "Removes the file or folder." }),
    executable: orDefault(z.boolean(), false),
  })
  .refine(
    (change) =>
      [
        change.text !== undefined,
        change.base64 !== undefined,
        change.parts !== undefined,
        change.from !== undefined,
        change.folder === true,
        change.delete === true,
      ].filter(Boolean).length === 1,
    { message: "give one of text, base64, parts, from, folder or delete" },
  )
  .openapi("FileChange", {
    description:
      "One change. Give exactly one of `text`, `base64`, `parts`, `from`, `folder` or `delete`.",
  });

export const NewCommit = z
  .object({
    message: z.string().min(1).max(10_000),
    session: z
      .string()
      .optional()
      .openapi({ description: "The session making the change. The commit records it." }),
    changes: z.array(FileChange).max(10_000),
  })
  .openapi("NewCommit");

export const Committed = z
  .object({
    head: z.string().openapi({ description: "The branch's head after the call." }),
    changed: z.boolean().openapi({
      description:
        "False when every change matched what was already there. Then no commit is made and `head` is the current one.",
    }),
  })
  .openapi("Committed");

export const commitFiles = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/branches/{branch}/commits",
  operationId: "commitFiles",
  tags: ["files"],
  summary:
    "Writes and deletes files, as one commit. All changes land, or none. Changes that match what is already there are skipped.",
  security: signedIn,
  request: { params: BranchParams, body: body(NewCommit) },
  responses: {
    201: json(Committed, "The commit."),
    200: json(Committed, "Nothing changed, so no commit was made."),
    ...errors(400, 401, 403, 404, 409),
  },
});

/** The most bytes in one uploaded part. */
export const PART_MAX = 16 * 1024 * 1024;

export const UploadedPart = z
  .object({
    part: z.string().openapi({ description: "The BLAKE3 hash of the bytes, in hex." }),
    size: z.number().int().openapi({ description: "Bytes." }),
  })
  .openapi("UploadedPart");

export const uploadPart = createRoute({
  method: "post",
  path: "/namespaces/{namespace}/uploads",
  operationId: "uploadPart",
  tags: ["files"],
  summary:
    "Uploads up to 16 MiB of a large file. Uploading the same bytes again is harmless, so a " +
    "part can be retried. A commit's `parts` joins parts into a file within 7 days.",
  security: signedIn,
  request: {
    params: NamespaceParams,
    body: {
      content: {
        "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) },
      },
      required: true,
    },
  },
  responses: {
    201: json(UploadedPart, "The part."),
    ...errors(400, 401, 403, 404),
    413: json(ErrorBody, "The part is over 16 MiB."),
  },
});
