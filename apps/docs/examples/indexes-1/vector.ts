import { Skywake } from "skywake";

const images = new Skywake().index("images");
await images.upsert([
  { id: "cat.jpg", embedding: [0.1, 0.9, 0.0], label: "cat", width: 640 },
  { id: "dog.jpg", embedding: [0.9, 0.1, 0.0], label: "dog", width: 1024 },
  { id: "fox.jpg", embedding: [0.5, 0.5, 0.2], label: "fox", width: 800 },
]);

const nearest = await images.query({ vector: [0.2, 0.8, 0.0], limit: 2 });
console.log(nearest);

const wide = await images.query({
  vector: [0.2, 0.8, 0.0],
  filter: { width: { gte: 800 } },
  fields: ["label"],
});
console.log(wide);
