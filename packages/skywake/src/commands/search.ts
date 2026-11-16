import {
  defineCommand,
  latin1FromBytes,
  type Command,
  type CommandContext,
  type ExecResult,
} from "just-bash";

import type { SkywakeFs } from "../fs.ts";
import { remote } from "../paths.ts";
import { trusted } from "../trusted.ts";
import { parse, type Spec } from "./args.ts";
import { builtIn, done, refused } from "./fallback.ts";
import { shownPath } from "./shown.ts";

const LIMIT = 1_000;

const RG: Spec = {
  flags: {
    "-i": "i",
    "--ignore-case": "i",
    "-S": "S",
    "--smart-case": "S",
    "-n": "n",
    "--line-number": "n",
    "-N": "-",
    "--no-line-number": "-",
    "-l": "l",
    "--files-with-matches": "l",
    "-F": "F",
    "--fixed-strings": "F",
    "-H": "-",
    "--with-filename": "-",
    "--no-heading": "-",
  },
  values: { "-g": "glob", "--glob": "glob", "-e": "e", "--regexp": "e" },
};

const GREP: Spec = {
  flags: {
    "-r": "r",
    "-R": "r",
    "--recursive": "r",
    "-i": "i",
    "--ignore-case": "i",
    "-n": "n",
    "--line-number": "n",
    "-l": "l",
    "--files-with-matches": "l",
    "-F": "F",
    "--fixed-strings": "F",
    "-E": "E",
    "--extended-regexp": "E",
    "-H": "-",
    "-I": "-",
    "-s": "-",
  },
  values: { "-e": "e", "--include": "glob" },
};

interface Asked {
  pattern: string;
  glob?: string;
  ignoreCase: boolean;
  lines: boolean;
  filesOnly: boolean;
  operands: string[];
}

export function searchCommands(fs: SkywakeFs): Command[] {
  return [
    defineCommand("rg", (args, ctx) => search(fs, "rg", args, ctx)),
    defineCommand("grep", (args, ctx) => search(fs, "grep", args, ctx)),
  ];
}

async function search(
  fs: SkywakeFs,
  name: "rg" | "grep",
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  const asked = understood(name, args, ctx);
  if (!asked) return builtIn(name, args, ctx);
  try {
    return (await served(fs, name, asked, ctx)) ?? (await builtIn(name, args, ctx));
  } catch (error) {
    return refused(name, error);
  }
}

function understood(name: "rg" | "grep", args: string[], ctx: CommandContext): Asked | null {
  const parsed = parse(args, name === "rg" ? RG : GREP);
  if (!parsed) return null;
  if (name === "grep" && !parsed.flags.has("r")) return null;
  const patterns = parsed.values.get("e") ?? [];
  const operands = [...parsed.operands];
  if (patterns.length === 0) {
    const first = operands.shift();
    if (first === undefined) return null;
    patterns.push(first);
  }
  if (name === "rg" && operands.length === 0 && latin1FromBytes(ctx.stdin).length > 0) return null;
  if (name === "grep" && operands.length === 0) operands.push(".");
  const globs = parsed.values.get("glob") ?? [];
  if (globs.length > 1 || globs.some((glob) => glob.startsWith("!"))) return null;
  const fixed = parsed.flags.has("F");
  const basic = name === "grep" && !fixed && !parsed.flags.has("E");
  const shaped = patterns.map((p) => (fixed ? escape(p) : basic ? extended(p) : p));
  const pattern = shaped.length === 1 ? shaped[0]! : shaped.map((p) => `(?:${p})`).join("|");
  const smart = parsed.flags.has("S") && pattern === pattern.toLowerCase();
  return {
    pattern,
    glob: globs[0],
    ignoreCase: parsed.flags.has("i") || smart,
    lines: parsed.flags.has("n"),
    filesOnly: parsed.flags.has("l"),
    operands,
  };
}

async function served(
  fs: SkywakeFs,
  name: string,
  asked: Asked,
  ctx: CommandContext,
): Promise<ExecResult | null> {
  const typed: (string | undefined)[] = asked.operands.length ? asked.operands : [undefined];
  const scopes = [];
  for (const operand of typed) {
    const scope = await fs.served(fs.resolvePath(ctx.cwd, operand ?? "."));
    if (!scope) return null;
    scopes.push({ operand, scope });
  }
  const out: string[] = [];
  const listed = new Set<string>();
  let stopped = false;
  for (const { operand, scope } of scopes) {
    const matches = await trusted(() =>
      fs.disk.grep(asked.pattern, {
        path: remote(scope.folder),
        glob: asked.glob,
        ignoreCase: asked.ignoreCase,
        at: scope.at || undefined,
        limit: LIMIT,
      }),
    );
    stopped ||= matches.length >= LIMIT;
    for (const match of matches) {
      const shown = shownPath(match.path, scope.folder, operand, ctx.cwd);
      if (asked.filesOnly) {
        if (!listed.has(shown)) out.push(shown);
        listed.add(shown);
      } else
        out.push(asked.lines ? `${shown}:${match.line}:${match.text}` : `${shown}:${match.text}`);
    }
  }
  const warning = stopped ? `${name}: stopped after ${LIMIT} matches; narrow the search\n` : "";
  return done(out.length ? `${out.join("\n")}\n` : "", out.length ? 0 : 1, warning);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extended(basic: string): string {
  let out = "";
  for (let i = 0; i < basic.length; i++) {
    const c = basic[i]!;
    if (c === "\\" && i + 1 < basic.length) {
      const next = basic[++i]!;
      out += "|(){}+?".includes(next) ? next : `\\${next}`;
    } else out += "|(){}+?".includes(c) ? `\\${c}` : c;
  }
  return out;
}
