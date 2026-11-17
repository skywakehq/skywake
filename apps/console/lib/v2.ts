import { envOf, nameInEnv } from "./names";
import { v2Api } from "./paths";

export class V2Error extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.hint = hint;
  }
}

export async function v2<T = unknown>(
  env: string,
  method: string,
  rest: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(v2Api(env, rest), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new V2Error(data?.error?.message ?? response.statusText, data?.error?.hint);
  }
  return data as T;
}

export const diskApi = (ns: string, rest = "") =>
  [envOf(ns), `disks/${encodeURIComponent(nameInEnv(ns))}${rest ? `/${rest}` : ""}`] as const;
