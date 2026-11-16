import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const docs = resolve(import.meta.dirname, "..");
const root = resolve(docs, "../..");
const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const examples = dirFlag < 0 ? join(docs, "examples") : resolve(args.splice(dirFlag, 2)[1]!);
const runs = join(docs, ".example-runs");
const url = need("SKYWAKE_SCENARIO_URL");
const admin = need("SKYWAKE_SCENARIO_ADMIN");
const only = args[0];
const TIMEOUT_MS = 120_000;
const PARALLEL = 4;

const RUNNERS: Record<string, (file: string) => string[]> = {
  ".ts": (file) => ["node", file],
  ".py": (file) => [
    "uv",
    "run",
    "--quiet",
    "--isolated",
    "--with-editable",
    join(root, "sdks/python"),
    "python",
    file,
  ],
  ".sh": (file) => ["bash", "-euo", "pipefail", file],
};

function need(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run this through scripts/scenarios.sh docs`);
  return value;
}

function scripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scripts(path);
    return extname(entry.name) in RUNNERS ? [path] : [];
  });
}

async function freshKey() {
  const response = await fetch(`${url}/v1/orgs`, {
    method: "POST",
    headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
    body: JSON.stringify({ name: `docs-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
  });
  if (!response.ok) throw new Error(`could not make an organization: ${response.status}`);
  return ((await response.json()) as { key: string }).key;
}

function run(file: string, key: string): Promise<{ ok: boolean; output: string }> {
  const work = mkdtempSync(join(runs, "run-"));
  cpSync(dirname(file), work, { recursive: true });
  const local = join(work, basename(file));
  const [command, ...args] = RUNNERS[extname(file)]!(local);
  return new Promise((done) => {
    const child = spawn(command!, args, {
      cwd: work,
      env: {
        ...process.env,
        SKYWAKE_URL: url,
        SKYWAKE_API_KEY: key,
        PATH: `${join(root, "target/debug")}:${process.env.PATH}`,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      rmSync(work, { recursive: true, force: true });
      done({ ok: code === 0, output });
    });
  });
}

const files = scripts(examples)
  .filter((file) => !only || relative(examples, file).startsWith(only))
  .sort();
const failed: string[] = [];
mkdirSync(runs, { recursive: true });
let next = 0;

async function worker() {
  while (next < files.length) {
    const file = files[next++]!;
    const name = relative(examples, file);
    const { ok, output } = await run(file, await freshKey());
    console.log(`${ok ? "ok" : "FAIL"} ${name}`);
    if (!ok) {
      failed.push(name);
      console.log(output.trimEnd().replace(/^/gm, "    "));
    }
  }
}

await Promise.all(Array.from({ length: PARALLEL }, worker));
console.log(`examples: ${files.length - failed.length} of ${files.length} ran`);
if (failed.length) process.exit(1);
