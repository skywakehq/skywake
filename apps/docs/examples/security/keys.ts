import { PermissionError, Skywake } from "skywake";

const sky = new Skywake();
await sky.createDisk("app");

const made = await sky.createKey({
  name: "agent-1",
  role: "write",
  environment: "default",
  only: ["app"],
  expiresInDays: 30,
});

const agent = new Skywake({ key: made.key });
await agent.disk("app").write("notes.md", "hello");

try {
  await agent.disk("billing").write("notes.md", "hello");
} catch (error) {
  if (!(error instanceof PermissionError)) throw error;
  console.log("billing:", error.message);
}

for await (const key of sky.listKeys()) {
  console.log(key.id, key.name, key.role, key.environment ?? "every", key.only.join(","));
}

await sky.revokeKey(made.id);
