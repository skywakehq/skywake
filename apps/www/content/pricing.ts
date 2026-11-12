import { site } from "./site";

export type Plan = {
  name: string;
  price: string;
  per: string;
  line: string;
  includes: string[];
  action: string;
  href: string;
  featured?: boolean;
};

const cloud = (action: string) =>
  site.cloudOpen
    ? { action, href: site.consoleUrl }
    : { action: "Join the waitlist", href: "#waitlist" };

export const plans: Plan[] = [
  {
    name: "Free",
    price: "$0",
    per: "no card",
    line: "To try it on a real project.",
    includes: [
      "1 GB in indexes",
      "1 GB written a month",
      "10 TB scanned a month",
      "10,000 embeddings a month",
      "1,000 reranks a month",
      "3 indexes",
      "5 GB of files",
      "10 GB of file downloads a month",
      "3 filesystems",
    ],
    ...cloud("Start free"),
  },
  {
    name: "Launch",
    price: "$16",
    per: "minimum a month",
    line: "Usage without limits. The minimum is credited back against usage.",
    includes: ["No usage limits", "Unlimited indexes", "Pinned indexes"],
    ...cloud("Start with Launch"),
  },
  {
    name: "Scale",
    price: "$128",
    per: "minimum a month",
    line: "For teams that answer to a security review.",
    includes: [
      "Everything in Launch",
      "Single sign-on",
      "Audit log",
      "IP allowlists",
      "Customer-managed keys",
    ],
    ...cloud("Start with Scale"),
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    per: "",
    line: "Your own terms, or the whole stack in your cloud.",
    includes: ["Everything in Scale", "Custom pricing and terms", "Deploy in your cloud"],
    action: "Talk to us",
    href: site.email ? `mailto:${site.email}` : `${site.docsUrl}/pricing`,
  },
];

export const usage = [
  { name: "Index storage", price: "$0.25", per: "GB-month" },
  { name: "Writes", price: "$1.50", per: "GB written" },
  { name: "Queries", price: "$0.75", per: "PB scanned" },
  { name: "Embeddings", price: "$0.01", per: "1,000 texts" },
  { name: "Reranks", price: "$0.02", per: "1,000 documents" },
  { name: "Pinned", price: "$0.001", per: "GB-hour" },
  { name: "Files storage", price: "$0.10", per: "GB-month" },
  { name: "File downloads", price: "$0.12", per: "GB downloaded" },
];

export const costExample = {
  agents: 100,
  workspaceGb: 10,
  changed: 0.02,
  copyMbPerSecond: 37,
  forkSeconds: 0.01,
  pricePerGbMonth: 0.023,
};
