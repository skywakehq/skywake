import { Skywake } from "skywake";

const sky = new Skywake();
const products = sky.index("products");
await products.upsert({ id: 1, text: "red running shoes", price: 89 });

const backup = await products.copy("products-backup");

for await (const index of sky.listIndexes()) console.log(index.name);

await backup.destroy();
console.log(await products.info());
