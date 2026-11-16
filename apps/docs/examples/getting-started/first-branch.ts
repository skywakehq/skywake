import { Skywake } from "skywake";

const app = new Skywake().disk("app");

await app.write(
  { "README.md": "# Shop\n", "config.toml": "port = 8080\n" },
  { message: "first version" },
);

const work = await app.fork("agent-1");
await work.write("config.toml", "port = 9090\n", { message: "change the port" });

console.log(await work.diff("main"));

await work.mergeInto("main");
console.log(await app.read("config.toml"));
