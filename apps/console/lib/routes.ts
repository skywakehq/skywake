import { namespaceName } from "./names.ts";

export const INDEX_TABS = ["overview", "query", "rows", "branches", "settings"] as const;
export type IndexTab = (typeof INDEX_TABS)[number];

export type Route =
  | { view: "home" }
  | { view: "settings" }
  | { view: "cli"; code: string }
  | { view: "indexes"; env: string }
  | { view: "index"; index: string; tab: IndexTab }
  | { view: "missing" };

const MISSING: Route = { view: "missing" };

function index(name: string, rest: string[]): Route {
  const [page = "overview", ...more] = rest;
  const tab = INDEX_TABS.find((t) => t === (page === "documents" ? "rows" : page));
  return tab && !more.length ? { view: "index", index: name, tab } : MISSING;
}

export function parse(path: string): Route {
  const [first, id, kind, name, ...rest] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (!first) return { view: "home" };
  if (first === "settings" && !id) return { view: first };
  if (first === "cli") return { view: "cli", code: id ?? "" };
  const tail = [kind, name, ...rest].filter((part): part is string => Boolean(part));
  if (first === "i" && id) return index(id, tail);
  if (first !== "e" || !id) return MISSING;
  if (!kind || (kind === "indexes" && !name)) return { view: "indexes", env: id };
  if (kind === "i" && name) return index(namespaceName(id, name), rest);
  return MISSING;
}
