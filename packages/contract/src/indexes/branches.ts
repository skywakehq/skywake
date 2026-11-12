import { Name, Time, z } from "../schemas.ts";
import { IndexVersionId } from "./fields.ts";
import { IndexStats } from "./schema.ts";

export const IndexVersion = z
  .object({
    version: z.string(),
    time: Time.openapi({ description: "When the branch came to be like this." }),
    rows: z.number().int().openapi({ description: "Documents a query found then." }),
  })
  .openapi("IndexVersion", { description: "A branch at one moment of its history." });

export const RestoreIndexBranch = z
  .object({ version: IndexVersionId.openapi({ description: "The version to go back to." }) })
  .openapi("RestoreIndexBranch");

export const IndexBranch = z
  .object({ name: z.string(), forked_from: z.string().nullable(), created: Time })
  .openapi("IndexBranch");

export const IndexBranchInfo = IndexBranch.extend({
  stats: IndexStats.nullable(),
}).openapi("IndexBranchInfo");

export const NewIndexBranch = z
  .object({
    name: Name.openapi({ example: "agents/try-1" }),
    from: Name.default("main").openapi({ description: "The branch to fork." }),
    at: IndexVersionId.optional().openapi({
      description: "Fork this older version of `from` instead of its head.",
    }),
  })
  .openapi("NewIndexBranch");

export const MergeIndexBranch = z
  .object({ from: Name.openapi({ description: "The branch whose writes are added." }) })
  .openapi("MergeIndexBranch");

export const Merged = z
  .object({ rows: z.number().int().openapi({ description: "Documents and deletes added." }) })
  .openapi("Merged");
