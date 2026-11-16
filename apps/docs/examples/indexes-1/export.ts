import { Skywake } from "skywake";

const products = new Skywake().index("products");
await products.upsert([
  { id: 1, text: "red running shoes", category: "shoes" },
  { id: 2, text: "wool beanie", category: "hats" },
  { id: 3, text: "trail running shoes", category: "shoes" },
]);

for await (const row of products.rows()) console.log(row);

for await (const row of products.rows({ filter: { category: "shoes" } })) console.log(row.id);
