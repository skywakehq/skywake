export const code = {
  "save-data.ts": `import { Skywake } from "skywake";

const sky = new Skywake();

const data = sky.disk("tickets");
const v1 = await data.upload("./tickets", {
  message: "Support tickets, March export",
});
`,
  "train.ts": `import type { Disk } from "skywake";

const cards = sky.disk("models");

async function train(data: Disk, model: string) {
  const commit = await data.download(\`./runs/\${model}\`);
  const card = { model, branch: data.branch, commit };
  await cards.write(\`\${model}.json\`, JSON.stringify(card, null, 2), {
    message: \`Trained \${model}\`,
  });
  return commit;
}

await train(data, "ticket-tagger-v7");
`,
  "open-data.ts": `const card = JSON.parse(await cards.read("ticket-tagger-v7.json"));
const file = await data.read("train/spam.jsonl", { at: card.commit });
console.log(file);
`,
  "fix.ts": `const fix = await data.fork("fix/spam-labels");

const spam = {
  text: "You won a free cruise, click here",
  label: "spam",
};
await fix.write("train/spam.jsonl", JSON.stringify(spam) + "\\n", {
  message: "Fix spam labels",
});
await fix.delete("train/old-2019.jsonl", {
  message: "Drop 2019 tickets",
});
`,
  "diff.ts": `for (const { change, path } of await fix.diff("main")) {
  console.log(change, path);
}
`,
  "keep.ts": `await train(fix, "ticket-tagger-v8");

const merged = await fix.mergeInto("main");
console.log("main now has the fix:", merged.commit);
`,
  "rebuild.ts": `const training = await sky.createKey({
  name: "training",
  role: "read",
  only: ["tickets"],
});

await data.download("./runs/v7-again", { at: card.commit });
`,
};

export const setup = `import { mkdirSync, writeFileSync } from "node:fs";

const line = (text: string, label: string) => JSON.stringify({ text, label }) + "\\n";
mkdirSync("./tickets/train", { recursive: true });
mkdirSync("./tickets/eval", { recursive: true });
writeFileSync("./tickets/train/billing.jsonl", line("I was charged twice", "billing"));
writeFileSync("./tickets/train/shipping.jsonl", line("Where is my parcel?", "shipping"));
writeFileSync(
  "./tickets/train/spam.jsonl",
  line("You won a free cruise, click here", "spam").repeat(2) +
    line("I want a refund for my order", "spam"),
);
writeFileSync("./tickets/train/old-2019.jsonl", line("Is the 2019 catalog out?", "shipping"));
writeFileSync("./tickets/eval/holdout.jsonl", line("My card was declined", "billing"));
`;
