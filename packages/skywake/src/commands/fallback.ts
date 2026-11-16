import { SkywakeError } from "@skywake/sdk";
import type { CommandContext, ExecResult } from "just-bash";

export function done(stdout: string, exitCode = 0, stderr = ""): ExecResult {
  return { stdout, stderr, exitCode };
}

export async function builtIn(
  name: string,
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  if (ctx.origCommand) return ctx.origCommand(args);
  return done("", 2, `${name}: not supported here\n`);
}

export function refused(name: string, error: unknown): ExecResult {
  if (error instanceof SkywakeError && error.status === 400) {
    return done("", 2, `${name}: ${error.message}\n`);
  }
  throw error;
}
