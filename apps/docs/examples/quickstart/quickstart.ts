import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert([
  { id: 1, text: "red running shoes", price: 89 },
  { id: 2, text: "waterproof hiking boots", price: 140 },
]);
console.log(await products.query("shoes for running", { filter: { price: { lt: 100 } } }));
