import { Skywake } from "skywake";

const sky = new Skywake();
const app = sky.disk("app");
await app.write("src/auth.ts", "export const timeout = 30;\n");

const work = await app.fork("agent-1");
await work.write("src/auth.ts", "export const timeout = 60;\n");

console.log("main:   ", await app.read("src/auth.ts"));
console.log("agent-1:", await work.read("src/auth.ts"));
console.log((await app.branches()).map((branch) => branch.name));

await work.destroy();
