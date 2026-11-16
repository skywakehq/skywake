import { Skywake } from "skywake";

const products = new Skywake().index("products");

const one = await products.upsert({ id: 1, text: "red running shoes", price: 89 });
console.log(one);

const many = await products.upsert([
  { id: 2, text: "trail running shoes", price: 120 },
  { text: "cotton sun hat", price: 25 },
]);
console.log(many);
