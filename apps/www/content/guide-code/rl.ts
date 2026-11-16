export const code = {
  "save-world.ts": `import { Skywake } from "skywake";

const sky = new Skywake();

const suite = sky.disk("task-suite");
const start = await suite.upload("./task-suite", {
  message: "Task suite v3",
});
const v3 = await suite.fork("v3");
`,
  "rollout.ts": `import type { Disk } from "skywake";

async function newRollout(id: string): Promise<Disk> {
  return v3.fork(\`rollout-\${id}\`);
}

const run = await newRollout("0001");
`,
  "tools.ts": `function toolsFor(run: Disk) {
  return {
    readFile: (path: string) => run.read(path),
    writeFile: (path: string, text: string) =>
      run.write(path, text, { message: \`policy: write \${path}\` }),
  };
}

const tools = toolsFor(run);
await policy(tools);
`,
  "score.ts": `import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function score(run: Disk, task: string) {
  const dir = await mkdtemp(join(tmpdir(), "rollout-"));
  await run.download(dir);
  try {
    execFileSync("node", [\`tasks/\${task}/test.js\`], {
      cwd: dir,
      stdio: "ignore",
    });
    return 1;
  } catch {
    return 0;
  } finally {
    await rm(dir, { recursive: true });
  }
}

const reward = await score(run, "date-parser");
`,
  "finish.ts": `async function finish(id: string, run: Disk) {
  const changed = await run.diff("v3");
  const touchedTests = changed.some((c) => c.path.endsWith("test.js"));
  if (touchedTests) {
    console.log(\`Look at rollout-\${id}:\`, changed);
  } else {
    await run.destroy();
  }
}

await finish("0001", run);
`,
  "many.ts": `const ids = Array.from({ length: 8 }, (_, i) => \`run-\${i}\`);

const rewards = await Promise.all(
  ids.map(async (id) => {
    const run = await newRollout(id);
    await policy(toolsFor(run));
    const reward = await score(run, "date-parser");
    await finish(id, run);
    return reward;
  }),
);
`,
  "new-version.ts": `const v4 = await suite.fork("suite-v4");
await v4.write(
  "tasks/slugify/README.md",
  "Also handle tabs and many spaces.",
  { message: "Task suite v4" },
);
await v4.mergeInto("main");
await v4.destroy();
`,
};

export const setup = `import { mkdir, writeFile } from "node:fs/promises";

for (const task of ["date-parser", "slugify"]) {
  await mkdir(\`./task-suite/tasks/\${task}\`, { recursive: true });
}
await writeFile("./task-suite/package.json", '{ "name": "task-suite", "type": "commonjs" }\\n');
await writeFile("./task-suite/tasks/date-parser/README.md", "Parse YYYY-MM-DD into a year.\\n");
await writeFile(
  "./task-suite/tasks/date-parser/parse.js",
  "exports.year = (s) => Number(s.slice(0, 2));\\n",
);
await writeFile(
  "./task-suite/tasks/date-parser/test.js",
  'if (require("./parse.js").year("2026-07-11") !== 2026) process.exit(1);\\n',
);
await writeFile("./task-suite/tasks/slugify/README.md", "Turn a title into a slug.\\n");
await writeFile(
  "./task-suite/tasks/slugify/slug.js",
  "exports.slug = (s) => s.toLowerCase();\\n",
);
await writeFile(
  "./task-suite/tasks/slugify/test.js",
  'if (require("./slug.js").slug("Hello World") !== "hello-world") process.exit(1);\\n',
);

type PolicyTools = {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, text: string) => Promise<unknown>;
};

async function policy(tools: PolicyTools) {
  const path = "tasks/date-parser/parse.js";
  const code = await tools.readFile(path);
  await tools.writeFile(path, code.replace("slice(0, 2)", "slice(0, 4)"));
}
`;
