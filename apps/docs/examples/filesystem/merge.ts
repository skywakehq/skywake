import { MergeConflict, Skywake } from "skywake";

const app = new Skywake().disk("app");
await app.write({ "README.md": "# App\n", "config.toml": "retries = 3\n" });

const work = await app.fork("agent-1");
await work.write("src/session.ts", "export const ttl = 3600;\n", { message: "Add sessions" });
await work.write("config.toml", "retries = 5\n");
await app.write("config.toml", "retries = 10\n");

console.log(await work.diff("main"));

try {
  await work.mergeInto("main");
} catch (error) {
  if (!(error instanceof MergeConflict)) throw error;
  console.log("conflicts:", error.conflicts);
  const { commit } = await work.mergeInto("main", { prefer: "theirs" });
  console.log("merged as", commit);
}

console.log(await app.read("config.toml"));
