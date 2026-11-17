import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert({ id: 1, text: "red running shoes", price: 89 });

const info = await products.configure({
  attributes: [{ name: "launched", type: "datetime" }],
  retentionDays: 30,
});
console.log(info.schema.attributes, info.retention_days);
