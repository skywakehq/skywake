import type { Disk } from "@skywake/sdk";
import { Bash, type BashOptions } from "just-bash";

import { findCommand } from "./commands/find.ts";
import { searchCommands } from "./commands/search.ts";
import { SkywakeFs } from "./fs.ts";
import { run, type Ran, type RunOptions } from "./run.ts";

export type ShellOptions = Omit<BashOptions, "fs" | "files">;

export interface Shell {
  bash: Bash;
  fs: SkywakeFs;
  run(command: string, options?: RunOptions): Promise<Ran>;
}

export function shell(disk: Disk, options: ShellOptions = {}): Shell {
  const fs = new SkywakeFs(disk);
  const bash = new Bash({
    cwd: "/",
    ...options,
    fs,
    customCommands: [...searchCommands(fs), findCommand(fs), ...(options.customCommands ?? [])],
  });
  const made: Shell = { bash, fs, run: (command, asked) => run(made, command, asked) };
  return made;
}
