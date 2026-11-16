import { tool } from "ai";
import { z } from "zod";

import { BASH_DESCRIPTION } from "./describe.ts";
import { run } from "./run.ts";
import type { Shell } from "./shell.ts";

export interface BashToolOptions {
  commitEach?: boolean;
}

export function bashTool(shell: Shell, options: BashToolOptions = {}) {
  const commitEach = options.commitEach ?? true;
  return tool({
    description: BASH_DESCRIPTION,
    inputSchema: z.object({ command: z.string().describe("The bash command to run.") }),
    execute: ({ command }) => run(shell, command, commitEach ? { commit: command } : {}),
  });
}
