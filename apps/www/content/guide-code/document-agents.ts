export const code = {
  "save-folder.ts": `import { Skywake } from "skywake";

const sky = new Skywake();

const acme = sky.disk("acme");
const start = await acme.upload("./acme-books", {
  message: "Acme books before the Q3 close",
});
`,
  "agent-copy.ts": `const { key } = await sky.createKey({
  name: "bookkeeper",
  role: "write",
  only: ["acme"],
  expiresInDays: 7,
});
const agentSky = new Skywake({ key });

const work = await agentSky.disk("acme").fork("q3-books");
`,
  "tools.ts": `const tools = {
  list: async () => {
    const entries = await work.list("", { recursive: true });
    return entries.filter((e) => e.kind === "file").map((e) => e.path);
  },
  read: (path: string) => work.read(path),
  write: (path: string, text: string, reason: string) =>
    work.write(path, text, { message: reason }),
};

await yourAgent(tools);
`,
  "review.ts": `const review = sky.disk("acme", { branch: "q3-books" });

for await (const commit of review.log()) {
  if (commit.id === start) break;
  console.log(commit.message);
}

const changed = await review.diff("main");
console.log(changed);
`,
  "lines.ts": `const before = (await acme.read("ledger.csv")).split("\\n");
const after = (await review.read("ledger.csv")).split("\\n");
const added = after.filter((line) => !before.includes(line));
`,
  "approve.ts": `const fixed = after.join("\\n").replace(
  "Hearth Oven Repair,845.00,Equipment",
  "Hearth Oven Repair,845.00,Repairs",
);
await review.write("ledger.csv", fixed, {
  message: "Oven repair goes to Repairs",
});

const approved = await review.mergeInto("main", {
  message: "Approve Q3 books",
});
`,
  "record.ts": `for await (const commit of acme.log({ path: "ledger.csv" })) {
  console.log(commit.created, commit.message);
}
`,
  "undo.ts": `await acme.revert(approved.commit!, {
  message: "Undo the Q3 approval",
});
`,
  "reject.ts": `await review.destroy();
`,
};

export const setup = `import { mkdir, writeFile } from "node:fs/promises";

await mkdir("./acme-books/invoices", { recursive: true });
await writeFile(
  "./acme-books/ledger.csv",
  "date,payee,amount,category\\n2026-06-30,Corner Dairy,410.00,Supplies\\n",
);
await writeFile("./acme-books/invoices/millers-flour-0711.txt", "Millers Flour Co. 1180.00\\n");
await writeFile("./acme-books/invoices/coldchain-0802.txt", "ColdChain Services 260.00\\n");
await writeFile("./acme-books/invoices/oven-repair-0915.txt", "Hearth Oven Repair 845.00\\n");
await writeFile("./acme-books/notes.md", "Small repairs go to Repairs.\\n");

type AgentTools = {
  list: () => Promise<string[]>;
  read: (path: string) => Promise<string>;
  write: (path: string, text: string, reason: string) => Promise<unknown>;
};

async function yourAgent(tools: AgentTools) {
  await tools.list();
  const ledger = await tools.read("ledger.csv");
  await tools.write(
    "ledger.csv",
    ledger +
      "2026-07-11,Millers Flour Co.,1180.00,Supplies\\n" +
      "2026-08-02,ColdChain Services,260.00,Repairs\\n" +
      "2026-09-15,Hearth Oven Repair,845.00,Equipment\\n",
    "Book 3 supplier invoices for Q3",
  );
  await tools.write("q3-summary.md", "Q3 costs: 2285.00\\n", "Write the Q3 summary");
}
`;
