import type { Branch } from "@skywake/sdk";
import { Bash, type BashOptions } from "just-bash";

import { findCommand } from "./commands/find.ts";
import { searchCommands } from "./commands/search.ts";
import { SkywakeFs } from "./fs.ts";

export type ShellOptions = Omit<BashOptions, "fs" | "files">;

export interface Shell {
  bash: Bash;
  fs: SkywakeFs;
}

export function createShell(branch: Branch, options: ShellOptions = {}): Shell {
  const fs = new SkywakeFs(branch);
  const bash = new Bash({
    cwd: "/",
    ...options,
    fs,
    customCommands: [...searchCommands(fs), findCommand(fs), ...(options.customCommands ?? [])],
  });
  return { bash, fs };
}
