import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert({
  id: 1,
  text: "red running shoes",
  price: 89,
  in_stock: true,
  tags: ["sale", "running"],
});

const { schema } = await products.info();
console.log(JSON.stringify(schema, null, 2));
