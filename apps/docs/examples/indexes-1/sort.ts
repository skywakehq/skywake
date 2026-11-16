import { readFileSync } from "node:fs";
import { Skywake } from "skywake";

const products = new Skywake().index("products");
const rows = readFileSync("products.jsonl", "utf8").trim().split("\n");
await products.upsert(rows.map((line) => JSON.parse(line)));

const priciest = await products.query({
  filter: { category: "shoes" },
  sort: { price: "desc" },
  limit: 2,
  fields: ["text", "price"],
});
console.log(priciest);
