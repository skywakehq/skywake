// The console's pages, read from an address.

const ENV_PAGES = ["activity", "indexes"] as const;
export const INDEX_TABS = ["overview", "query", "documents", "branches", "settings"] as const;
export type IndexTab = (typeof INDEX_TABS)[number];

export type Route =
  | { view: "home" }
  | { view: "settings" }
  | { view: "usage" }
  | { view: "filesystems"; env: string }
  | { view: (typeof ENV_PAGES)[number]; env: string }
  | { view: "files" | "branches" | "history"; ns: string }
  | { view: "branch"; ns: string; branch: string }
  | { view: "index"; index: string; tab: IndexTab }
  | { view: "missing" };

export function parse(path: string): Route {
  const [first, id, page, ...rest] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (!first) return { view: "home" };
  if ((first === "settings" || first === "usage") && !id) return { view: first };
  if (first === "e" && id && !rest.length) {
    if (!page) return { view: "filesystems", env: id };
    const view = ENV_PAGES.find((p) => p === page);
    if (view) return { view, env: id };
  }
  if (first === "n" && id) {
    if ((!page || page === "files") && !rest.length) return { view: "files", ns: id };
    if ((page === "branches" || page === "history") && !rest.length) return { view: page, ns: id };
    if (page === "b" && rest.length) return { view: "branch", ns: id, branch: rest.join("/") };
  }
  if (first === "i" && id && !rest.length) {
    const tab = page ? INDEX_TABS.find((t) => t === page) : "overview";
    if (tab) return { view: "index", index: id, tab };
  }
  return { view: "missing" };
}
