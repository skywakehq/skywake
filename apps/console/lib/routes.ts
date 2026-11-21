import { namespaceName } from "./names.ts";

const ENV_PAGES = ["activity"] as const;
const DISK_TABS = ["files", "branches", "history", "search"] as const;

export type Route =
  | { view: "home" }
  | { view: "settings" }
  | { view: "usage" }
  | { view: "cli"; code: string }
  | { view: "desktop" }
  | { view: "disks"; env: string }
  | { view: (typeof ENV_PAGES)[number]; env: string }
  | { view: (typeof DISK_TABS)[number]; ns: string }
  | { view: "branch"; ns: string; branch: string }
  | { view: "missing" };

const MISSING: Route = { view: "missing" };

function disk(ns: string, rest: string[]): Route {
  const at = ns.indexOf("@");
  if (at > 0) {
    const branch = [ns.slice(at + 1), ...rest].join("/");
    return branch ? { view: "branch", ns: ns.slice(0, at), branch } : MISSING;
  }
  const [page = "files", ...more] = rest;
  const view = DISK_TABS.find((tab) => tab === page);
  return view && !more.length ? { view, ns } : MISSING;
}

function legacyDisk(ns: string, [page, ...rest]: string[]): Route {
  if (page === "b") return rest.length ? { view: "branch", ns, branch: rest.join("/") } : MISSING;
  return disk(ns, page ? [page, ...rest] : []);
}

export function parse(path: string): Route {
  const [first, id, kind, name, ...rest] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (!first) return { view: "home" };
  if ((first === "settings" || first === "usage") && !id) return { view: first };
  if (first === "cli") return { view: "cli", code: id ?? "" };
  if (first === "desktop" && !id) return { view: "desktop" };
  const tail = [kind, name, ...rest].filter((part): part is string => Boolean(part));
  if (first === "n" && id) return legacyDisk(id, tail);
  if (first !== "e" || !id) return MISSING;
  if (!kind) return { view: "disks", env: id };
  if (!name) {
    const view = ENV_PAGES.find((p) => p === kind);
    return view ? { view, env: id } : MISSING;
  }
  if (kind === "d") return disk(namespaceName(id, name), rest);
  return MISSING;
}
