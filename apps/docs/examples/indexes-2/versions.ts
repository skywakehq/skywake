import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert({ id: 1, text: "red running shoes", price: 89 });
await products.update(1, { price: 79 });

const [, before] = await products.versions();
console.log("now", (await products.get(1))!.price);

const audit = await products.fork("audit", { at: before!.id });
console.log("audit", (await audit.get(1))!.price);

await products.restore(before!.id);
console.log("restored", (await products.get(1))!.price);
