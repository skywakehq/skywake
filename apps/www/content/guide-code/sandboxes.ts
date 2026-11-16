export const code = {
  "save-base.ts": `import { Skywake } from "skywake";

const sky = new Skywake();
const app = sky.disk("shop-app");
await app.upload("./workspace", { message: "Base workspace" });
`,
  "new-sandbox.ts": `await app.fork("sb-1842");

const sandbox = sky.disk("shop-app", { branch: "sb-1842" });
await sandbox.download("./sandbox");
`,
  "work.ts": `import { readFile, readdir } from "node:fs/promises";

const saved = await readFile("./sandbox/progress.json", "utf8")
  .catch(() => \`{ "done": 0 }\`);
const progress = JSON.parse(saved);
const tests = (await readdir("./sandbox/tests")).sort();

for (const name of tests.slice(progress.done)) {
  const path = \`tests/\${name}\`;
  await migrate(\`./sandbox/\${path}\`);
  progress.done += 1;
  await sandbox.write(
    {
      [path]: await readFile(\`./sandbox/\${path}\`, "utf8"),
      "progress.json": JSON.stringify(progress),
    },
    { message: \`Migrated \${path}\` },
  );
}
`,
  "resume.ts": `for await (const commit of sandbox.log({ limit: 3 })) {
  console.log(commit.message);
}
`,
  "finish.ts": `await sandbox.delete("progress.json", { message: "Job done" });
const changed = await sandbox.diff("main");
console.log(\`\${changed.length} files changed\`);

await sandbox.mergeInto("main");
await sandbox.destroy();
`,
};

export const setup = `import { mkdir, writeFile } from "node:fs/promises";

await mkdir("./workspace/src", { recursive: true });
await mkdir("./workspace/tests", { recursive: true });
await writeFile("./workspace/package.json", JSON.stringify({ name: "shop-app", type: "module" }));
await writeFile("./workspace/src/cart.js", "export const total = (items) => items.length;\\n");
for (let n = 1; n <= 40; n++) {
  const file = \`./workspace/tests/t\${String(n).padStart(2, "0")}.test.js\`;
  await writeFile(file, \`const { check } = require("old-runner");\\ncheck(\${n} > 0);\\n\`);
}

async function migrate(file: string) {
  const text = await readFile(file, "utf8");
  await writeFile(
    file,
    text
      .replace('const { check } = require("old-runner");', 'import assert from "node:assert";')
      .replace("check(", "assert.ok("),
  );
}
`;
