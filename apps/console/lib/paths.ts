import { envOf, nameInEnv } from "./names";
import { withBase } from "./zone";

const enc = encodeURIComponent;

export const envPath = (env: string) => `/e/${enc(env)}`;

export const indexPath = (index: string, tab = "overview") =>
  `/e/${enc(envOf(index))}/i/${enc(nameInEnv(index))}${tab === "overview" ? "" : `/${tab}`}`;

export const isIndexPath = (path: string) => /^\/(i|e\/[^/]+\/i)\//.test(path);

export const indexApi = (index?: string, rest = "") =>
  withBase(
    `/api/skywake/indexes${index === undefined ? "" : `/${enc(index)}`}${rest ? `/${rest}` : ""}`,
  );

export const v2Api = (env: string, rest: string) =>
  withBase(`/api/v2/${enc(env)}/${rest.replace(/^\/+/, "")}`);
