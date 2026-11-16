export const code = {
  "save-repo.ts": `import { Skywake } from "skywake";

const sky = new Skywake();
const shop = sky.disk("shop");
await shop.upload("./shop", { message: "Shop, ready to test" });
`,
  "start-agents.ts": `const task = "Login fails when the email has capital letters.";
const tries = await Promise.all(
  [1, 2, 3].map((n) => shop.fork(\`try-\${n}\`)),
);
`,
  "run-try.ts": `import { spawnSync } from "node:child_process";
import type { Disk } from "skywake";

async function runTry(branch: Disk, task: string) {
  const dir = \`./work/\${branch.branch}\`;
  await branch.download(dir);

  await yourAgent(dir, task);

  const tests = spawnSync("npm", ["test"], { cwd: dir });
  const passed = tests.status === 0;
  await branch.upload(dir, {
    message: passed ? "Tests pass" : "Tests fail",
  });
  return { branch, passed };
}

const results = await Promise.all(tries.map((t) => runTry(t, task)));
`,
  "review.ts": `for (const { branch, passed } of results) {
  const changed = await branch.diff("main");
  console.log(
    branch.branch,
    passed ? "pass" : "fail",
    changed.map((c) => \`\${c.change} \${c.path}\`),
  );
}
`,
  "keep.ts": `await tries[0]!.mergeInto("main");
for (const t of tries) await t.destroy();
`,
  "many-tasks.ts": `import { MergeConflict } from "skywake";

const jobs = [
  { name: "longer-sessions", task: "Keep people signed in 30 days." },
  { name: "trim-spaces", task: "Ignore spaces around the email." },
  { name: "ignore-case", task: "Saved emails may have capitals." },
];
const forks = await Promise.all(jobs.map((j) => shop.fork(j.name)));
await Promise.all(forks.map((f, i) => runTry(f, jobs[i]!.task)));

for (const fork of forks) {
  try {
    await fork.mergeInto("main");
    console.log(fork.branch, "merged");
  } catch (error) {
    if (!(error instanceof MergeConflict)) throw error;
    console.log(fork.branch, error.conflicts);
  }
}
`,
};

export const setup = `import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const files: Record<string, string> = {
  "package.json": JSON.stringify({ name: "shop", type: "module", scripts: { test: "node --test test/login.test.js" } }),
  "node_modules/ms/package.json": JSON.stringify({ name: "ms", main: "index.js" }),
  "node_modules/ms/index.js": "module.exports = (text) => parseInt(text, 10) * 86400000;\\n",
  "src/login.js": [
    'import ms from "ms";',
    "",
    'export const SESSION = ms("1d");',
    "",
    "export function login(users, email) {",
    "  const key = email;",
    "  return users.find((user) => user.email === key) ?? null;",
    "}",
    "",
  ].join("\\n"),
  "test/login.test.js": [
    'import { test } from "node:test";',
    'import assert from "node:assert";',
    'import { login } from "../src/login.js";',
    "",
    'test("login ignores capital letters", () => {',
    '  assert.ok(login([{ email: "ann@shop.com" }], "Ann@Shop.com"));',
    "});",
    "",
  ].join("\\n"),
};
for (const [path, text] of Object.entries(files)) {
  await mkdir(join("./shop", path, ".."), { recursive: true });
  await writeFile(join("./shop", path), text);
}

const edits: Record<string, [string, string, string]> = {
  "try-1": ["src/login.js", "const key = email;", "const key = email.toLowerCase();"],
  "try-2": ["test/login.test.js", "Ann@Shop.com", "ann@shop.com"],
  "try-3": ["src/login.js", "const key = email;", "const key = email.toUpperCase();"],
  "longer-sessions": ["src/login.js", 'ms("1d")', 'ms("30d")'],
  "trim-spaces": ["src/login.js", "email.toLowerCase()", "email.trim().toLowerCase()"],
  "ignore-case": [
    "src/login.js",
    "  const key = email.toLowerCase();\\n  return users.find((user) => user.email === key) ?? null;",
    "  return users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;",
  ],
};

async function yourAgent(dir: string, task: string) {
  const [file, from, to] = edits[basename(dir)]!;
  const path = join(dir, file);
  await writeFile(path, (await readFile(path, "utf8")).replace(from, to));
}
`;
