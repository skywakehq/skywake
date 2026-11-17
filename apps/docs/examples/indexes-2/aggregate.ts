import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert([
  { id: 1, text: "red running shoes", tag: "shoes", price: 89 },
  { id: 2, text: "trail shoes", tag: "shoes", price: 120 },
  { id: 3, text: "wool socks", tag: "socks", price: 12 },
]);

const groups = await products.aggregate({
  groupBy: "tag",
  sum: "price",
  min: "price",
  filter: { price: { gt: 0 } },
});
console.log(groups);
