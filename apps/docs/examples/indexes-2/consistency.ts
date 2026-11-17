import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert({ id: 1, text: "red running shoes", price: 89 });
await products.update(1, { price: 79 });

const [hit] = await products.query("running shoes", { limit: 1 });
console.log(hit!.price, await products.count());
