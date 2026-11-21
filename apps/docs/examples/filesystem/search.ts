import { Skywake } from "skywake";

const sky = new Skywake();
const app = await sky.createDisk("app", { search: true });
await app.write({
  "docs/retries.md": "Retry failed requests with exponential backoff.",
  "docs/auth.md": "Sign requests with your API key.",
});

let hits = await app.query("retry backoff", { limit: 1 });
for (let i = 0; i < 50 && hits.length === 0; i++) {
  await new Promise((done) => setTimeout(done, 200));
  hits = await app.query("retry backoff", { limit: 1 });
}
console.log(hits);
