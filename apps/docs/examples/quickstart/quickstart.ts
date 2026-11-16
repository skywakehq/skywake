import { Skywake } from "skywake";

const app = new Skywake().disk("app");
await app.write("hello.txt", "hi");
console.log(await app.read("hello.txt"));
