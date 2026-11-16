import { Skywake } from "skywake";

const products = new Skywake().index("products");

await products.upsert([
  { id: 1, text: "red running shoes", category: "shoes", price: 89 },
  { id: 2, text: "waterproof hiking boots", category: "shoes", price: 140 },
  { id: 3, text: "cotton running socks", category: "socks", price: 12 },
]);

const hits = await products.query("shoes for running", { filter: { price: { lt: 100 } } });
console.log(hits.map((hit) => `${hit.id} ${hit.text} $${hit.price}`));

const draft = await products.fork("draft");
await draft.upsert({ id: 4, text: "trail running shoes", category: "shoes", price: 95 });
console.log("draft:", await draft.count(), "main:", await products.count());

await draft.mergeInto("main");
console.log("main after merge:", await products.count());
