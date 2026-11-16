import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const www = resolve(import.meta.dirname, "..");
const sources = join(www, "content/guide-code");
const out = join(www, ".guide-programs");

type Guide = { code: Record<string, string>; setup?: string };

const IMPORT = /^import\s[^;]*;\s*$/gm;

function program({ code, setup = "" }: Guide) {
  const parts = [setup, ...Object.entries(code).filter(([file]) => file.endsWith(".ts")).map(([, body]) => body)];
  const imports = new Set(parts.flatMap((part) => part.match(IMPORT) ?? []).map((line) => line.trim()));
  const bodies = parts.map((part) => part.replace(IMPORT, "").trim()).filter(Boolean);
  return [...imports, "", ...bodies, ""].join("\n");
}

rmSync(out, { recursive: true, force: true });
for (const file of readdirSync(sources).filter((name) => name.endsWith(".ts"))) {
  const id = file.slice(0, -3);
  const guide = (await import(pathToFileURL(join(sources, file)).href)) as Guide;
  mkdirSync(join(out, id), { recursive: true });
  writeFileSync(join(out, id, `${id}.ts`), program(guide));
}
console.log(`guide programs written to ${out}`);
