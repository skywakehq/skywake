export type Page = { title: string; description: string; priority: number };

export const pages = {
  "/": {
    title: "Skywake: A shared disk for AI agents, with search built in",
    description:
      "An open-source shared disk for AI agents. Mount it on any machine, let every agent read and write the same files, and search them by meaning or exact words.",
    priority: 1,
  },
  "/use-cases": {
    title: "Use cases: knowledge bases, agent memory, coding agents and more",
    description:
      "How teams use Skywake for knowledge bases, agent memory, sandboxes, coding and document agents, evals, CI and datasets, step by step.",
    priority: 0.7,
  },
  "/pricing": {
    title: "Pricing",
    description:
      "Free to self-host, with every feature and no limits. Skywake Cloud is free to start, then $20 or $50 a month plus usage.",
    priority: 0.8,
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
