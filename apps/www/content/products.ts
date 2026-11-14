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

export type Feature = { name: string; line: string; art: MiniArtName; span: 2 | 3 | 4 };
