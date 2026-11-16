import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const docs = resolve(import.meta.dirname, "..");
const content = join(docs, "content/docs");
const examples = join(docs, "examples");
const RUNNABLE = new Set(["ts", "tsx", "js", "py", "python", "bash", "sh", "shell"]);
const SCRIPTS = new Set([".ts", ".py", ".sh"]);
const FENCE = /^(`{3,})(\S*)([^\n]*)$/gm;
const INCLUDE = /<include\b[^>]*>([^<]+)<\/include>/g;

function files(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

const problems: string[] = [];
const included = new Set<string>();

for (const page of files(content, (name) => name.endsWith(".mdx"))) {
  const text = readFileSync(page, "utf8");
  const where = relative(docs, page);
  let open: string | null = null;
  for (const [line, ticks, lang, meta] of text.matchAll(FENCE)) {
    if (open) {
      if (ticks === open && !lang) open = null;
      continue;
    }
    open = ticks!;
    if (RUNNABLE.has(lang!) && !/\bnorun\b/.test(meta!)) {
      problems.push(`${where}: \`${line.trim()}\` is inline; put it in examples/ and <include> it, or mark it norun`);
    }
  }
  for (const [, target] of text.matchAll(INCLUDE)) {
    const path = resolve(dirname(page), target!.trim().split("#")[0]!);
    if (!existsSync(path)) problems.push(`${where}: includes ${target}, which doesn't exist`);
    included.add(path);
  }
}

for (const script of files(examples, (name) => SCRIPTS.has(extname(name)))) {
  if (!included.has(script)) problems.push(`${relative(docs, script)} is run but no page shows it`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`docs examples: every runnable block is an included, tested file (${included.size})`);
