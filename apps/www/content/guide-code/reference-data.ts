export const code = {
  "save-refs.ts": `import { Skywake } from "skywake";

const sky = new Skywake();

const genome = sky.disk("genome");
await genome.upload("./grch38", { message: "GRCh38, first release" });
await genome.fork("grch38");
`,
  "lock.ts": `const agents = await sky.createKey({
  name: "agents",
  role: "read",
  only: ["genome"],
});
await saveSecret("AGENT_KEY", agents.key);
`,
  "refs.ts": `const refs = new Skywake({ key: process.env.AGENT_KEY }).disk("genome", {
  branch: process.env.REFS_RELEASE,
});
`,
  "read.ts": `const piece = await refs.read("chr1.fa", {
  offset: 120_000,
  length: 600,
});
`,
  "sync-refs.ts": `import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const REFS = process.env.REFS_DIR ?? "/srv/refs";

async function syncRefs(dir = REFS) {
  const mark = join(dir, ".release");
  const have = await readFile(mark, "utf8").catch(() => "");
  if (have === refs.branch) return;

  if (!have) {
    await refs.download(dir);
  } else {
    for (const { path, change } of await refs.diff(have)) {
      const file = join(dir, path);
      await rm(file, { force: true });
      if (change === "removed") continue;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, await refs.read(path, { as: "stream" }));
    }
  }
  await writeFile(mark, refs.branch);
}
`,
  "start.ts": `await syncRefs();
`,
  "agent.ts": `const genes = await readFile(join(REFS, "genes.gtf"), "utf8");
`,
  "release.ts": `const next = await genome.fork("grch38-p2");
await next.upload("./grch38-p2", { message: "GRCh38 patch 2" });
await next.mergeInto("main");
`,
};

export const setup = `import { mkdirSync, writeFileSync } from "node:fs";

async function saveSecret(name: string, value: string) {
  process.env[name] = value;
}

process.env.REFS_DIR = "./refs";
process.env.REFS_RELEASE = "grch38";
const bases = (n: number) => ">chr\\n" + "ACGT".repeat(n / 4) + "\\n";
for (const dir of ["./grch38", "./grch38-p2"]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(\`\${dir}/chr1.fa\`, bases(130_000));
  writeFileSync(\`\${dir}/genes.gtf\`, "chr1\\tBRCA1\\t120000\\t120600\\n");
}
writeFileSync("./grch38/chr2.fa", bases(4_000));
writeFileSync("./grch38-p2/chr2.fa", bases(4_004));
writeFileSync("./grch38-p2/chrY.fa", bases(2_000));
`;
