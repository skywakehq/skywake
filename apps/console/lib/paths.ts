import { envOf, nameInEnv } from "./names";
import { withBase } from "./zone";

const enc = encodeURIComponent;

const segments = (path: string) => path.split("/").map(enc).join("/");

const place = (full: string) => `/e/${enc(envOf(full))}/d/${enc(nameInEnv(full))}`;

export const nsPath = (ns: string, page = "files") =>
  `${place(ns)}${page === "files" ? "" : `/${page}`}`;

export const branchPath = (ns: string, branch: string, query?: Record<string, string>) =>
  `${place(ns)}@${segments(branch)}` + (query ? `?${new URLSearchParams(query)}` : "");

export const apiPath = (ns: string, rest: string) =>
  withBase(`/api/skywake/namespaces/${enc(ns)}/${rest}`);

export const decode = decodeURIComponent;

export const envPath = (env: string, page?: "activity") =>
  `/e/${enc(env)}${page ? `/${page}` : ""}`;

export const v2Api = (env: string, rest: string) =>
  withBase(`/api/v2/${enc(env)}/${rest.replace(/^\/+/, "")}`);
