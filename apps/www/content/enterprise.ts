export type EnterpriseFeature = { name: string; line: string; fact: string };

export const enterpriseFeatures: EnterpriseFeature[] = [
  {
    name: "Single sign-on",
    line: "SAML or OIDC, through your identity provider.",
    fact: "required for your email domains",
  },
  {
    name: "API keys",
    line: "Read, write or admin, scoped to namespaces.",
    fact: "prod/* · expiry · spotted by secret scanners",
  },
  {
    name: "Audit log",
    line: "Every change, with who made it.",
    fact: "keys, branches, merges, settings",
  },
  {
    name: "Credentials",
    line: "Storage keys that reach one namespace.",
    fact: "15 minutes, no deletes",
  },
  {
    name: "Regions",
    line: "Choose where each filesystem and index lives.",
    fact: "one bucket per region",
  },
  {
    name: "IP allowlist",
    line: "Only your networks reach your data.",
    fact: "IPv4 and IPv6 ranges",
  },
  {
    name: "Invoices",
    line: "Usage priced per index, every month.",
    fact: "queries, writes, GB-months",
  },
  { name: "Self-host", line: "The whole stack on one machine.", fact: "docker compose up" },
  {
    name: "Your cloud",
    line: "A Helm chart, with an API that scales itself.",
    fact: "your account, your bucket",
  },
];
