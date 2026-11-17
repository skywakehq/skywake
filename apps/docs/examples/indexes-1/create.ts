import { Skywake } from "skywake";

const sky = new Skywake();

const products = await sky.createIndex("products", {
  schema: {
    vectors: [],
    attributes: [
      { name: "text", type: "text" },
      { name: "category", type: "string" },
      { name: "price", type: "number" },
    ],
  },
});

const info = await products.info();
console.log(info.schema);
