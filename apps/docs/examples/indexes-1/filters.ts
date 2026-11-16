import { readFileSync } from "node:fs";
import { Skywake } from "skywake";

const products = new Skywake().index("products");
const rows = readFileSync("products.jsonl", "utf8").trim().split("\n");
await products.upsert(rows.map((line) => JSON.parse(line)));

const shoes = await products.query("shoes", {
  filter: { category: "shoes", price: { lt: 130 }, tags: { contains: "running" } },
  fields: ["text", "price"],
});
console.log(shoes);

const inStock = await products.query({
  filter: {
    or: [{ category: "hats" }, { price: { gte: 120 } }],
    not: { in_stock: false },
  },
  fields: ["text", "price"],
});
console.log(inStock);
