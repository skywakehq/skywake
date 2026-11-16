import { Skywake } from "skywake";

const sky = new Skywake();
const products = sky.index("products");

await products.upsert([
  { id: 1, text: "red running shoes", price: 89 },
  { id: 2, text: "waterproof hiking boots", price: 140 },
  { id: 3, text: "cotton sun hat", price: 25 },
]);

const hits = await products.query("shoes for running", { limit: 2 });
console.log(hits);
