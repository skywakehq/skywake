export const setup = `import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

process.env.CI_JOB_ID ??= "4812";

const build = [
  'import { createHash } from "node:crypto";',
  'import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";',
  "let compiled = 0;",
  "let cached = 0;",
  'mkdirSync(".cache", { recursive: true });',
  'mkdirSync("dist", { recursive: true });',
  'for (const name of readdirSync("src")) {',
  '  const source = readFileSync("src/" + name, "utf8");',
  '  const entry = ".cache/" + createHash("sha256").update(source).digest("hex").slice(0, 16) + ".js";',
  "  if (existsSync(entry)) cached++;",
  '  else { writeFileSync(entry, source.replace(/: [a-z\\\\[\\\\]]+/g, "")); compiled++; }',
  '  copyFileSync(entry, "dist/" + name.replace(/\\\\.ts$/, ".js"));',
  "}",
  'console.log("compiled " + compiled + ", cached " + cached);',
].join("\\n");

const seed: Record<string, string> = {
  "web-app/package.json": JSON.stringify({ name: "web-app", private: true, scripts: { build: "node build.mjs" } }),
  "web-app/build.mjs": build,
  "web-app/src/cart.ts": "export const cart: string[] = [];\\n",
  "web-app/src/checkout.ts": "export const checkout = (total: number) => total;\\n",
  "web-app/src/prices.ts": "export const price = (cents: number) => cents / 100;\\n",
  "web-app/src/search.ts": "export const search = (text: string) => text.trim();\\n",
  "pr/src/cart.ts": "export const cart: string[] = [];\\nexport const count = () => cart.length;\\n",
};
for (const [name, body] of Object.entries(seed)) {
  mkdirSync(dirname(name), { recursive: true });
  writeFileSync(name, body);
}
`;

export const code = {
  "setup.ts": `import { Skywake } from "skywake";

const sky = new Skywake();

const app = await sky.createDisk("web-app");
await app.fork("warm");
`,
  "nightly.ts": `import { execSync } from "node:child_process";

const warm = sky.disk("web-app", { branch: "warm" });

// Build main first, so the cache is full when we save it.
execSync("npm run build", { cwd: "./web-app", stdio: "inherit" });
await warm.upload("./web-app", { message: "Nightly build" });
`,
  "job.ts": `const id = process.env.CI_JOB_ID;
const job = await warm.fork(\`jobs/\${id}\`);
`,
  "pull-request.ts": `import { readFileSync } from "node:fs";

// The files this pull request changed, from its shallow fetch.
const files = ["src/cart.ts"];
await job.write(
  Object.fromEntries(
    files.map((f) => [f, readFileSync(\`./pr/\${f}\`, "utf8")]),
  ),
  { message: \`Job \${id}: pull request files\` },
);
`,
  "build.ts": `await job.download("./work");
const log = execSync("npm run build", {
  cwd: "./work",
  encoding: "utf8",
});
console.log(log);
`,
  "save.ts": `await job.upload("./work", { message: \`Job \${id}: output\` });
const changed = await job.diff("warm");
`,
  "cleanup.ts": `await job.destroy();
`,
  "yesterday.ts": `const [, lastNight] = await Array.fromAsync(warm.log({ limit: 2 }));
const old = await warm.fork("jobs/yesterday", { at: lastNight.id });
await old.download("./old");
`,
};
