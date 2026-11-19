import { PermissionError, Skywake } from "skywake";

const sky = new Skywake();
await sky.index("products").upsert({ id: 1, text: "red running shoes" });

const made = await sky.createKey({
  name: "agent-1",
  role: "write",
  environment: "default",
  only: ["products"],
  expiresInDays: 30,
});

const agent = new Skywake({ key: made.key });
await agent.index("products").upsert({ id: 2, text: "waterproof hiking boots" });

try {
  await agent.index("billing").upsert({ id: 1, text: "hello" });
} catch (error) {
  if (!(error instanceof PermissionError)) throw error;
  console.log("billing:", error.message);
}

for await (const key of sky.listKeys()) {
  console.log(key.id, key.name, key.role, key.environment ?? "every", key.only.join(","));
}

await sky.revokeKey(made.id);
