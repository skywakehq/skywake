export const code = {
  "new-memory.ts": `import { Skywake } from "skywake";

const sky = new Skywake();

await sky.disk("memory-agent-37").write(
  {
    "decisions.md": "# Decisions\\n",
    "people.md": "# People\\n",
    "notes.md": "# Where I left off\\n",
  },
  { message: "Empty memory" },
);
`,
  "agent-key.ts": `const { key } = await sky.createKey({
  name: "agent-37",
  role: "write",
  only: ["memory-agent-37"],
});
`,
  "remember.ts": `const agent = new Skywake({ key });
const memory = agent.disk("memory-agent-37");

async function remember(file: string, line: string) {
  const before = await memory.read(file);
  await memory.write(file, \`\${before}- \${line}\\n\`, { message: line });
}
`,
  "monday.ts": `await remember("decisions.md", "Login uses passkeys, not SMS codes.");
await remember("people.md", "Maya reviews all auth changes.");
await remember("notes.md", "Stopped at: the sign-up form.");
`,
  "recall.ts": `async function recall(topic: string) {
  const notes = await memory.read("notes.md");
  const hits = await memory.grep(topic, { ignoreCase: true });
  const known = hits.map((hit) => \`\${hit.path}: \${hit.text}\`);
  return [notes, \`About \${topic}:\`, ...known].join("\\n");
}

const context = await recall("login");
`,
  "tuesday.ts": `await remember("decisions.md", "Keep SMS codes as a backup login.");
`,
  "look-back.ts": `const review = sky.disk("memory-agent-37");

for await (const commit of review.log({ limit: 10 })) {
  console.log(commit.id.slice(0, 7), commit.message);
}

await review.download("./agent-37");
`,
  "forget.ts": `for await (const commit of review.log({ limit: 10 })) {
  if (commit.message.startsWith("Keep SMS codes")) {
    await review.revert(commit.id, { message: "Forget: SMS backup" });
    break;
  }
}
`,
  "read-all.ts": `const reader = await sky.createKey({
  name: "memory-reader",
  role: "read",
  only: ["memory-*"],
});
`,
};
