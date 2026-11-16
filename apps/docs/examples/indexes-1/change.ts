import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert([
  { id: 1, text: "red running shoes", price: 89, stock: 4, badge: "new" },
  { id: 2, text: "wool beanie", price: 30, stock: 0 },
  { id: 3, text: "cotton sun hat", price: 25, stock: 0 },
]);

await products.update(1, { price: 79, badge: null });
await products.update({ stock: 0 }, { status: "sold out" });
console.log(await products.get(1));
console.log(await products.get(2));

await products.delete(2);
await products.delete({ filter: { status: "sold out" } });
console.log(await products.get(2), await products.count());
