import { Skywake } from "skywake";
import { shell } from "skywake/bash";

const app = new Skywake().disk("app");
await app.write({
  "src/auth.ts": "// TODO: expire sessions\nexport const login = () => {};\n",
  "src/cart.ts": "// TODO: keep the cart across devices\nexport const cart = [];\n",
});

const work = await app.fork("agent-1");
const sh = shell(work);

const found = await sh.run("rg -n TODO src");
console.log(found.stdout);

const wrote = await sh.run("rg -o 'TODO: .*' src | sort > TODO.md && wc -l TODO.md", {
  commit: "List the TODOs",
});
console.log(wrote.stdout, wrote.committed);

console.log(await work.read("TODO.md"));
await work.mergeInto("main");
