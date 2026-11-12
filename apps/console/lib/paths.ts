import { withBase } from "./zone";

// Namespace and branch names hold `/`, so they are encoded in page addresses.

export const nsPath = (ns: string, page = "files") => `/n/${encodeURIComponent(ns)}/${page}`;

export const branchPath = (ns: string, branch: string, query?: Record<string, string>) =>
  `/n/${encodeURIComponent(ns)}/b/${branch.split("/").map(encodeURIComponent).join("/")}` +
  (query ? `?${new URLSearchParams(query)}` : "");

/** A skywake-api path, through the console's proxy. */
export const apiPath = (ns: string, rest: string) =>
  withBase(`/api/skywake/namespaces/${encodeURIComponent(ns)}/${rest}`);

export const decode = decodeURIComponent;

/** An environment's pages: its filesystems (the home), activity and indexes. */
export const envPath = (env: string, page?: "activity" | "indexes") =>
  `/e/${encodeURIComponent(env)}${page ? `/${page}` : ""}`;

/** A search index's page, one tab of it. */
export const indexPath = (index: string, tab = "overview") =>
  `/i/${encodeURIComponent(index)}${tab === "overview" ? "" : `/${tab}`}`;

/** A skywake-api index path, through the console's proxy. */
export const indexApi = (index?: string, rest = "") =>
  withBase(
    `/api/skywake/indexes${index === undefined ? "" : `/${encodeURIComponent(index)}`}${rest ? `/${rest}` : ""}`,
  );
