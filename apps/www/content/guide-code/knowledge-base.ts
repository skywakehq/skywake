export const setup = `import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const seed: Record<string, string> = {
  "billing/refunds.md": "Annual plans can be refunded within 60 days.\\n",
  "billing/invoices.md": "Invoices are sent by email on the first day of each month.\\n",
  "plans/annual.md": "The annual plan costs 12 times the monthly price.\\n",
  "account/reset-password.md": "To reset your password, open Settings and choose Reset password.\\n",
  "account/sso.md": "SSO works with any SAML or OIDC provider on the Business plan.\\n",
};
for (const [path, text] of Object.entries(seed)) {
  mkdirSync(dirname(\`help-center/\${path}\`), { recursive: true });
  writeFileSync(\`help-center/\${path}\`, text);
}
`;

export const code = {
  "save-docs.ts": `import { Skywake } from "skywake";

const sky = new Skywake();

const help = sky.disk("help");
await help.upload("./help-center", { message: "Help center today" });
`,
  "create-index.ts": `await help.configure({ search: true });
`,
  "tool.ts": `export async function searchDocs(question: string) {
  const hits = await help.query(question, { limit: 5 });
  return hits.map((hit) => ({ path: hit.path, text: hit.snippet }));
}
`,
  "update.ts": `await help.write(
  "billing/refunds.md",
  "Annual plans can be refunded within 30 days.",
  { message: "Refunds: 30 days, not 60" },
);
`,
  "draft.ts": `const draft = await help.fork("new-pricing");
await draft.write(
  "plans/annual.md",
  "The annual plan costs 10 times the monthly price.",
  { message: "New pricing" },
);
`,
  "publish.ts": `await draft.mergeInto("main");
`,
};
