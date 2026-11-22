import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collect } from "@skywake/sdk";
import { z } from "zod";

import { BASH_DESCRIPTION } from "../describe.ts";
import type { Places } from "./places.ts";
import { DESTROY, READ, WRITE, guarded, json, text } from "./results.ts";

const disk = z.string().optional().describe("The disk. SKYWAKE_DISK by default.");

/**
 * Registers the disk tools. `write` says whether the key may write; it is asked
 * while the client connects, so the write tools are there from the start and
 * are taken away if the key turns out to be read-only.
 */
export function fileTools(server: McpServer, places: Places, write: Promise<boolean>) {
  server.registerTool(
    "read",
    {
      description: "Reads a file as text.",
      inputSchema: {
        path: z.string(),
        offset: z.number().int().optional(),
        length: z.number().int().optional(),
        disk,
      },
      annotations: READ,
    },
    guarded(async ({ path, offset, length, disk }) =>
      text(await (await places.reading(disk)).read(path, { offset, length })),
    ),
  );

  server.registerTool(
    "list",
    {
      description: "Lists a folder: each entry's path, kind, size and modified time.",
      inputSchema: { path: z.string().optional(), recursive: z.boolean().optional(), disk },
      annotations: READ,
    },
    guarded(async ({ path, recursive, disk }) =>
      json(await (await places.reading(disk)).list(path ?? "", { recursive })),
    ),
  );

  server.registerTool(
    "grep",
    {
      description: "Finds lines that match a regular expression, on the server.",
      inputSchema: {
        pattern: z.string(),
        path: z.string().optional(),
        glob: z.string().optional(),
        ignore_case: z.boolean().optional(),
        disk,
      },
      annotations: READ,
    },
    guarded(async ({ pattern, path, glob, ignore_case, disk }) =>
      json(
        await (await places.reading(disk)).grep(pattern, { path, glob, ignoreCase: ignore_case }),
      ),
    ),
  );

  server.registerTool(
    "find",
    {
      description: "Finds paths that match a glob, such as `**/*.md`.",
      inputSchema: {
        glob: z.string(),
        path: z.string().optional(),
        kind: z.enum(["any", "files", "folders"]).optional(),
        disk,
      },
      annotations: READ,
    },
    guarded(async ({ glob, path, kind, disk }) =>
      json(await (await places.reading(disk)).find(glob, { path, kind })),
    ),
  );

  server.registerTool(
    "query",
    {
      description:
        "Searches the disk's files by meaning and keywords; the best file first, with a snippet.",
      inputSchema: {
        text: z.string(),
        limit: z.number().int().optional(),
        path: z.string().optional(),
        disk,
      },
      annotations: READ,
    },
    guarded(async ({ text: words, limit, path, disk }) =>
      json(await (await places.reading(disk)).query(words, { limit, path })),
    ),
  );

  server.registerTool(
    "log",
    {
      description: "The newest commits of the branch, or of one path.",
      inputSchema: { path: z.string().optional(), limit: z.number().int().optional(), disk },
      annotations: READ,
    },
    guarded(async ({ path, limit = 20, disk }) => {
      const commits = await collect((await places.reading(disk)).log({ path, limit }));
      return json(commits.slice(0, limit));
    }),
  );

  server.registerTool(
    "diff",
    {
      description: "What this branch changed compared with another branch, main by default.",
      inputSchema: { against: z.string().optional(), disk },
      annotations: READ,
    },
    guarded(async ({ against, disk }) =>
      json(await (await places.reading(disk)).diff(against ?? "main")),
    ),
  );

  server.registerTool(
    "bash",
    { description: BASH_DESCRIPTION, inputSchema: { command: z.string(), disk } },
    guarded(async ({ command, disk }) => {
      const writes = await write;
      const shell = await places.shell(disk, writes);
      const ran = await shell.run(command, writes ? { commit: command } : {});
      const body = [ran.stdout, ran.stderr && `stderr:\n${ran.stderr}`, `exit ${ran.exitCode}`]
        .filter(Boolean)
        .join("\n");
      return text(body, ran.exitCode !== 0);
    }),
  );

  const writers = [
    server.registerTool(
      "write",
      {
        description:
          "Writes files, as one commit. Without SKYWAKE_BRANCH it writes to this session's own branch.",
        inputSchema: {
          files: z.record(z.string(), z.string()),
          message: z.string().optional(),
          disk,
        },
        annotations: WRITE,
      },
      guarded(async ({ files, message, disk }) =>
        json(await (await places.writing(disk)).write(files, { message })),
      ),
    ),

    server.registerTool(
      "delete",
      {
        description: "Deletes files or folders, as one commit.",
        inputSchema: { paths: z.array(z.string()), message: z.string().optional(), disk },
        annotations: DESTROY,
      },
      guarded(async ({ paths, message, disk }) =>
        json(await (await places.writing(disk)).delete(paths, { message })),
      ),
    ),

    server.registerTool(
      "fork",
      {
        description: "Forks the branch in use into a new one, and works there from now on.",
        inputSchema: { name: z.string(), disk },
        annotations: WRITE,
      },
      guarded(async ({ name, disk }) => {
        const forked = await (await places.reading(disk)).fork(name);
        places.use(disk, forked.branch);
        return json({ disk: forked.name, branch: forked.branch });
      }),
    ),

    server.registerTool(
      "merge",
      {
        description:
          "Merges the branch in use into another, main by default. Conflicts are listed, not guessed.",
        inputSchema: {
          into: z.string().optional(),
          message: z.string().optional(),
          prefer: z.enum(["ours", "theirs"]).optional(),
          dry_run: z.boolean().optional(),
          disk,
        },
        // It changes the branch merged into, main by default, and `prefer` overwrites there.
        annotations: DESTROY,
      },
      guarded(async ({ into, message, prefer, dry_run, disk }) =>
        json(
          await (
            await places.writing(disk)
          ).mergeInto(into ?? "main", { message, prefer, dryRun: dry_run }),
        ),
      ),
    ),
  ];
  write.then(
    (yes) => yes || writers.forEach((tool) => tool.remove()),
    () => {},
  );
}
