import type { Disk } from "@skywake/sdk";
import { tool } from "ai";
import { z } from "zod";

import { BASH_DESCRIPTION } from "./describe.ts";
import { shell as open, type Shell } from "./shell.ts";

export interface BashToolOptions {
  commitEach?: boolean;
}

const isShell = (target: Disk | Shell): target is Shell => "bash" in target && "fs" in target;

export function bashTool(target: Disk | Shell, options: BashToolOptions = {}) {
  const shell = isShell(target) ? target : open(target);
  const commitEach = options.commitEach ?? true;
  return tool({
    description: BASH_DESCRIPTION,
    inputSchema: z.object({ command: z.string().describe("The bash command to run.") }),
    execute: ({ command }) => shell.run(command, commitEach ? { commit: command } : {}),
  });
}
