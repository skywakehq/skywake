import { envOf, nameInEnv } from "./names";
import { withBase } from "./zone";

const enc = encodeURIComponent;

const segments = (path: string) => path.split("/").map(enc).join("/");

const place = (kind: "d" | "i", full: string) =>
  `/e/${enc(envOf(full))}/${kind}/${enc(nameInEnv(full))}`;

export const nsPath = (ns: string, page = "files") =>
  `${place("d", ns)}${page === "files" ? "" : `/${page}`}`;

export const branchPath = (ns: string, branch: string, query?: Record<string, string>) =>
  `${place("d", ns)}@${segments(branch)}` + (query ? `?${new URLSearchParams(query)}` : "");

export const apiPath = (ns: string, rest: string) =>
  withBase(`/api/skywake/namespaces/${enc(ns)}/${rest}`);

export const decode = decodeURIComponent;

export const envPath = (env: string, page?: "activity" | "indexes") =>
  `/e/${enc(env)}${page ? `/${page}` : ""}`;

export const indexPath = (index: string, tab = "overview") =>
  `${place("i", index)}${tab === "overview" ? "" : `/${tab}`}`;

export const isIndexPath = (path: string) => /^\/(i|e\/[^/]+\/i)\//.test(path);

export const indexApi = (index?: string, rest = "") =>
  withBase(
    `/api/skywake/indexes${index === undefined ? "" : `/${enc(index)}`}${rest ? `/${rest}` : ""}`,
  );

export const v2Api = (env: string, rest: string) =>
  withBase(`/api/v2/${enc(env)}/${rest.replace(/^\/+/, "")}`);
