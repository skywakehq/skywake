import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert({ id: 1, text: "red running shoes", price: 89 });

await products.configure({ pinned: { replicas: 2 } });
console.log("pinned");

await products.configure({ pinned: null });
console.log("unpinned");
