import { Skywake } from "skywake";

const sky = new Skywake();
const logs = await sky.createIndex("logs", {
  embed: false,
  schema: { vectors: [], attributes: [{ name: "text", type: "text" }] },
});
await logs.upsert({ id: 1, text: "timeout talking to the payment service" });

console.log(await logs.query("payment timeout"));
