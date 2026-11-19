export type Page = { title: string; description: string; priority: number };

export const pages = {
  "/": {
    title: "Skywake: open-source search on object storage",
    description:
      "Vector, full-text and hybrid search that keeps its data in your own S3, R2, GCS or Azure bucket. An open-source alternative to turbopuffer, under Apache-2.0.",
    priority: 1,
  },
  "/pricing": {
    title: "Pricing",
    description:
      "Free to self-host, with every feature and no limits. Skywake Cloud is in private beta.",
    priority: 0.8,
  },
  "/benchmarks": {
    title: "Benchmarks",
    description:
      "Search over 10M vectors on S3, measured on AWS with the bucket in the same region: cold and warm queries, filters, recall and freshness.",
    priority: 0.7,
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
