import { MergeConflict, Skywake } from "skywake";

const sky = new Skywake();
const app = sky.disk("app");
await app.write("TODO.md", "- ship login\n");

const work = await app.fork("agent-1");
await work.write("TODO.md", "- ship login\n- add sessions\n");
await app.write("TODO.md", "- ship login\n- fix signup\n");

const combine = (ours: string, theirs: string) =>
  [...new Set([...ours.split("\n"), ...theirs.split("\n")])].filter(Boolean).join("\n") + "\n";

try {
  await work.mergeInto("main");
} catch (error) {
  if (!(error instanceof MergeConflict)) throw error;
  const settled: Record<string, string> = {};
  for (const path of error.conflicts) {
    settled[path] = combine(await app.read(path), await work.read(path));
  }
  await app.mergeInto(work.branch, { prefer: "ours" });
  await work.write(settled, { message: "Settle conflicts with main" });
  await work.mergeInto("main");
}

console.log(await app.read("TODO.md"));
