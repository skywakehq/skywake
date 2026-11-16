import { NotFound, Skywake } from "skywake";

const sky = new Skywake();
await sky.index("products").upsert({ id: 1, text: "red running shoes", price: 89 });

try {
  await sky.index("prodcts").query("shoes");
} catch (error) {
  if (!(error instanceof NotFound)) throw error;
  console.log(error.code, error.message);
  console.log("hint:", error.hint);
}
