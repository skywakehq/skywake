export type MiniArtName =
  | "fork"
  | "mount"
  | "autosave"
  | "recover"
  | "diff"
  | "merge"
  | "protect"
  | "vector"
  | "fullText"
  | "hybrid"
  | "sparse"
  | "late"
  | "analytics"
  | "branches"
  | "timeTravel";

export type Product = {
  name: string;
  href: string;
  icon: "files" | "search";
  line: [string, string, string];
  points: string[];
};

export const products: Product[] = [
  {
    name: "Filesystem",
    href: "/filesystem",
    icon: "files",
    line: [
      "Every agent gets ",
      "its own copy of your files",
      ", ready in milliseconds and mounted like a normal folder.",
    ],
    points: [
      "A copy of 20,000 files in 10 ms",
      "A local folder on any machine",
      "Diff and merge like git",
    ],
  },
  {
    name: "Index",
    href: "/search",
    icon: "search",
    line: [
      "",
      "Vector and full-text search",
      " next to your files, with branches like your files.",
    ],
    points: [
      "411 ms cold over 10M vectors",
      "Vector, full-text and hybrid",
      "Fork and restore any version",
    ],
  },
];

export type Feature = { name: string; line: string; art: MiniArtName; span: 2 | 3 | 4 };

export const fileFeatures: Feature[] = [
  { name: "Fork", line: "A full copy for every agent, at any size.", art: "fork", span: 4 },
  { name: "Mount", line: "Any branch, as a local folder.", art: "mount", span: 2 },
  { name: "Autosave", line: "Saved every 2 seconds. fsync means saved.", art: "autosave", span: 2 },
  { name: "Recover", line: "Nothing unsaved is ever thrown away.", art: "recover", span: 2 },
  { name: "Diff", line: "See what an agent changed.", art: "diff", span: 2 },
  { name: "Merge", line: "Three-way, line by line, like git.", art: "merge", span: 3 },
  { name: "Protect", line: "Main changes only through a merge.", art: "protect", span: 3 },
];

export const searchFeatures: Feature[] = [
  { name: "Vector", line: "Nearest neighbours, filtered, on your bucket.", art: "vector", span: 3 },
  { name: "Full-text", line: "BM25 with phrases, prefixes and typos.", art: "fullText", span: 3 },
  { name: "Hybrid", line: "Meaning and words, fused in one call.", art: "hybrid", span: 2 },
  { name: "Sparse", line: "SPLADE-style learned sparse vectors.", art: "sparse", span: 2 },
  { name: "Late interaction", line: "ColBERT, scored token by token.", art: "late", span: 2 },
  { name: "Analytics", line: "Count, sum and group any attribute.", art: "analytics", span: 2 },
  { name: "Branches", line: "Fork an index like a folder.", art: "branches", span: 2 },
  { name: "Time travel", line: "Restore any past version.", art: "timeTravel", span: 2 },
];
