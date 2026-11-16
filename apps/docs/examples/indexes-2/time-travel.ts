import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert({ id: 1, text: "red running shoes", price: 89 });

const draft = await products.fork("draft");
await draft.upsert({ id: 2, text: "trail shoes", price: 120 });
console.log("main", await products.count(), "draft", await draft.count());

const { rows } = await draft.mergeInto("main");
console.log("merged", rows, "rows; main has", await products.count());
await draft.destroy();
