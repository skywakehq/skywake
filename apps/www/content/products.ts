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
      "Opens like a normal folder",
      "See and merge what changed, like git",
    ],
  },
  {
    name: "Index",
    href: "/search",
    icon: "search",
    line: ["", "Find anything in your data", " by meaning, by keyword, or both."],
    points: [
      "10M items searched in 10 ms",
      "Works with any embedding model",
      "Go back to any earlier version",
    ],
  },
];

export type Feature = { name: string; line: string; art: MiniArtName; span: 2 | 3 | 4 };

export const fileFeatures: Feature[] = [
  {
    name: "Instant copies",
    line: "A full copy for every agent, however big.",
    art: "fork",
    span: 4,
  },
  { name: "A normal folder", line: "Open any version on any machine.", art: "mount", span: 2 },
  { name: "Autosave", line: "Saves every 2 seconds, on its own.", art: "autosave", span: 2 },
  { name: "Nothing lost", line: "Even a crash keeps what was saved.", art: "recover", span: 2 },
  { name: "See changes", line: "Exactly what each agent touched.", art: "diff", span: 2 },
  { name: "Merge back", line: "Combine changes line by line, like git.", art: "merge", span: 3 },
  { name: "Protected main", line: "Main only changes through a merge.", art: "protect", span: 3 },
];

export const searchFeatures: Feature[] = [
  {
    name: "By meaning",
    line: "Finds what matches the idea, not just the words.",
    art: "vector",
    span: 3,
  },
  {
    name: "By keyword",
    line: "Exact words and phrases, even with typos.",
    art: "fullText",
    span: 3,
  },
  { name: "Both at once", line: "Meaning and keywords, ranked together.", art: "hybrid", span: 2 },
  { name: "Sparse vectors", line: "For SPLADE-style models.", art: "sparse", span: 2 },
  { name: "Multi-vector", line: "ColBERT-style, scored word by word.", art: "late", span: 2 },
  { name: "Counts and totals", line: "Count, sum and group anything.", art: "analytics", span: 2 },
  { name: "Copies", line: "Copy an index as easily as a folder.", art: "branches", span: 2 },
  { name: "Undo", line: "Go back to any earlier version.", art: "timeTravel", span: 2 },
];
