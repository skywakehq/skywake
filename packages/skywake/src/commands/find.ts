import { defineCommand, type Command, type CommandContext, type ExecResult } from "just-bash";

import type { SkywakeFs } from "../fs.ts";
import { remote } from "../paths.ts";
import { trusted } from "../trusted.ts";
import { builtIn, done, refused } from "./fallback.ts";
import { shownPath } from "./shown.ts";

const LIMIT = 100_000;

interface Asked {
  starts: string[];
  name?: string;
  kind: "any" | "files" | "folders";
}

export function findCommand(fs: SkywakeFs): Command {
  return defineCommand("find", async (args, ctx) => {
    const asked = understood(args);
    if (!asked) return builtIn("find", args, ctx);
    try {
      return (await served(fs, asked, ctx)) ?? (await builtIn("find", args, ctx));
    } catch (error) {
      return refused("find", error);
    }
  });
}

function understood(args: string[]): Asked | null {
  const split = args.findIndex((arg) => arg.startsWith("-") || arg === "(" || arg === "!");
  const starts = split < 0 ? args : args.slice(0, split);
  const asked: Asked = { starts: starts.length ? starts : ["."], kind: "any" };
  const expression = split < 0 ? [] : args.slice(split);
  for (let i = 0; i < expression.length; i++) {
    const option = expression[i];
    const value = expression[i + 1];
    if (option === "-print") continue;
    if (option === "-name" && value !== undefined && asked.name === undefined) {
      asked.name = value;
    } else if (option === "-type" && (value === "f" || value === "d") && asked.kind === "any") {
      asked.kind = value === "f" ? "files" : "folders";
    } else return null;
    i++;
  }
  return asked;
}

async function served(
  fs: SkywakeFs,
  asked: Asked,
  ctx: CommandContext,
): Promise<ExecResult | null> {
  const scopes = [];
  for (const start of asked.starts) {
    const scope = await fs.served(fs.resolvePath(ctx.cwd, start));
    if (!scope) return null;
    scopes.push({ start, scope });
  }
  const out: string[] = [];
  let stopped = false;
  for (const { start, scope } of scopes) {
    if (asked.name === undefined && asked.kind !== "files") out.push(start);
    const found = await trusted(() =>
      fs.branch.find(asked.name ?? "*", {
        path: remote(scope.folder),
        kind: asked.kind,
        at: scope.at,
        limit: LIMIT,
      }),
    );
    stopped ||= found.length >= LIMIT;
    for (const entry of found) out.push(shownPath(entry.path, scope.folder, start, ctx.cwd));
  }
  const warning = stopped ? `find: stopped after ${LIMIT} paths; narrow the search\n` : "";
  return done(out.length ? `${out.join("\n")}\n` : "", 0, warning);
}
