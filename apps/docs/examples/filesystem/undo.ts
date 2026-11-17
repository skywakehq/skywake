import { Skywake } from "skywake";

const app = new Skywake().disk("app");
const good = await app.write("config.toml", "retries = 3\n", { message: "Set retries" });
const bad = await app.write("config.toml", "retries = 0\n", { message: "Turn retries off" });

console.log("then:", await app.read("config.toml", { at: good.commit }));

await app.revert(bad.commit);
console.log("after revert:", await app.read("config.toml"));

await app.write("notes.md", "draft\n");
await app.restore(good.commit);
console.log("after restore:", await app.exists("notes.md"));

for await (const commit of app.log({ limit: 5 })) {
  console.log(commit.id.slice(0, 12), commit.message);
}
