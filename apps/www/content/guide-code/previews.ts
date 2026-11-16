export const setup = `import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const seed: Record<string, string> = {
  "shop-data/catalog/products.json": JSON.stringify(
    [
      { id: "mug", name: "Mug", price: "12.00", currency: "USD" },
      { id: "tote", name: "Tote bag", price: "24,00", currency: "EUR" },
      { id: "cap", name: "Cap", price: "18.50", currency: "USD" },
    ],
    null,
    2,
  ),
  "shop-data/catalog/stock.json": JSON.stringify({ mug: 40, tote: 12, cap: 7 }, null, 2),
  "shop-data/config/shipping.json": JSON.stringify({ free_over_cents: 5000 }, null, 2),
  "shop-data/uploads/banner.txt": "Summer sale\\n",
};
for (const [name, body] of Object.entries(seed)) {
  mkdirSync(dirname(name), { recursive: true });
  writeFileSync(name, body);
}
`;

export const code = {
  "save-data.ts": `import { Skywake } from "skywake";

const sky = new Skywake();

const shop = sky.disk("shop-data");
await shop.upload("./shop-data", { message: "Shop data today" });
`,
  "fork.ts": `const pr = await shop.fork("pr-512");
const start = await pr.head();
`,
  "preview.ts": `type Product = { id: string; price: string; currency: string };
const file = "catalog/products.json";

async function migrate(toCents: (price: string) => number) {
  const products: Product[] = JSON.parse(await pr.read(file));
  const moved = products.map(({ price, ...product }) => ({
    ...product,
    cents: toCents(price),
  }));
  await pr.write(file, JSON.stringify(moved, null, 2), {
    message: "PR 512: store prices in cents",
  });
}

await migrate((price) => Math.round(Number(price) * 100));
await pr.download("./previews/pr-512");
`,
  "try-again.ts": `await pr.restore(start!);
const toCents = (price: string) =>
  Math.round(Number(price.replace(",", ".")) * 100);
await migrate(toCents);
await pr.download("./previews/pr-512");
`,
  "review.ts": `const review = await sky.createKey({
  name: "Review PR 512",
  role: "read",
  only: ["shop-data"],
  expiresInDays: 7,
});
`,
  "reviewer.ts": `const reviewer = new Skywake({ key: review.key });
const copy = reviewer.disk("shop-data", { branch: "pr-512" });

const changed = await copy.diff("main");
console.log(changed);
`,
  "ship.ts": `await pr.mergeInto("main", { message: "Ship PR 512" });
await pr.destroy();
await sky.revokeKey(review.id);
`,
  "on-pull-request.ts": `export async function onPullRequest(n: number, event: string) {
  const name = \`pr-\${n}\`;
  const copy = sky.disk("shop-data", { branch: name });
  if (event === "opened") {
    await shop.fork(name);
    await copy.download(\`./previews/\${name}\`);
  }
  if (event === "merged") {
    await copy.mergeInto("main");
  }
  if (event === "merged" || event === "closed") {
    await copy.destroy();
  }
}
`,
};
