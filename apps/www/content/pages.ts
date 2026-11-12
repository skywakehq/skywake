export type Page = { title: string; description: string; priority: number };

export const pages = {
  "/": {
    title: "Skywake: A scalable filesystem and search engine for AI agents",
    description:
      "Open-source filesystem and hybrid search on your own S3 bucket. Fork a workspace for every agent in milliseconds, mount it like a local disk, and search by meaning or keyword.",
    priority: 1,
  },
  "/filesystem": {
    title: "S3 filesystem for AI agents: mount, copy and merge",
    description:
      "Mount S3 or any object storage as a fast local disk. Give every agent its own copy of 20,000 files in 10 ms, then diff and merge the changes like git.",
    priority: 0.9,
  },
  "/search": {
    title: "Vector and full-text search on S3",
    description:
      "Vector, full-text and hybrid search straight from your own object storage. 10 ms warm queries over 10M vectors, and no separate database to run.",
    priority: 0.9,
  },
  "/agents": {
    title: "MCP server, CLI and SDKs for AI agents",
    description:
      "Give agents files and search through an MCP server, one CLI, a web console, and SDKs in TypeScript, Python, Go, Rust, Ruby, Java and C#.",
    priority: 0.8,
  },
  "/use-cases": {
    title: "Use cases: agent sandboxes, RL environments, CI",
    description:
      "Sandboxes, RL environments, CI, preview environments, datasets and shared data on one bucket, step by step.",
    priority: 0.7,
  },
  "/pricing": {
    title: "Pricing",
    description: "Pay for what you use, from $0. Self-hosting the open-source version is free.",
    priority: 0.8,
  },
  "/enterprise": {
    title: "Enterprise",
    description:
      "Single sign-on, audit log, IP allowlist, scoped keys, regions, or the whole stack in your own cloud.",
    priority: 0.6,
  },
  "/privacy": {
    title: "Privacy",
    description: "What this site collects, why, and how to have it deleted.",
    priority: 0.2,
  },
  "/terms": {
    title: "Terms",
    description: "The terms for using this site and the Skywake software.",
    priority: 0.2,
  },
} satisfies Record<string, Page>;

export type PagePath = keyof typeof pages;

export const pagePaths = Object.keys(pages) as PagePath[];

export const imageSlug = (path: PagePath) => (path === "/" ? "home" : path.slice(1));
