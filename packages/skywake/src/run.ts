import type { SkywakeFs } from "./fs.ts";

const OUTPUT_MAX = 30_000;

export interface Ran {
  stdout: string;
  stderr: string;
  exitCode: number;
  committed?: string;
}

export interface RunOptions {
  commit?: string;
}

interface Runs {
  bash: { exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> };
  fs: SkywakeFs;
}

export async function run(shell: Runs, command: string, options: RunOptions = {}): Promise<Ran> {
  const result = await shell.bash.exec(command);
  const ran: Ran = {
    stdout: clipped(result.stdout),
    stderr: clipped(result.stderr),
    exitCode: result.exitCode,
  };
  if (options.commit !== undefined) {
    const head = await shell.fs.commit(options.commit);
    if (head) ran.committed = head;
  }
  return ran;
}

function clipped(text: string): string {
  if (text.length <= OUTPUT_MAX) return text;
  const cut = text.length - OUTPUT_MAX;
  return `${text.slice(0, OUTPUT_MAX)}\n[${cut} more characters cut; narrow the command]\n`;
}
