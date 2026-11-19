import { errorOf } from "./errors.js";

type Value = string | number | boolean | undefined | null;
export type Query = Record<string, Value>;

export interface Request {
  query?: Query;
  json?: unknown;
}

export const segment = (name: string) => encodeURIComponent(name);

export class Http {
  readonly #base: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: (request: globalThis.Request) => Promise<Response>;

  constructor(
    base: string,
    headers: Record<string, string>,
    send: (request: globalThis.Request) => Promise<Response>,
  ) {
    this.#base = base;
    this.#headers = headers;
    this.#fetch = send;
  }

  in(environment: string): Http {
    return new Http(
      this.#base,
      { ...this.#headers, "skywake-environment": environment },
      this.#fetch,
    );
  }

  async call<T>(method: string, path: string, request: Request = {}): Promise<T> {
    const url = new URL(this.#base + path);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
    const headers = new Headers(this.#headers);
    let body: string | undefined;
    if (request.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(request.json);
    }
    const response = await this.#fetch(new globalThis.Request(url, { method, headers, body }));
    const text = await response.text();
    if (response.ok) return (text ? JSON.parse(text) : undefined) as T;
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    throw errorOf(response, parsed);
  }

  get = <T>(path: string, query?: Query) => this.call<T>("GET", path, { query });
  post = <T>(path: string, json: unknown = {}, query?: Query) =>
    this.call<T>("POST", path, { json, query });
  patch = <T>(path: string, json: unknown, query?: Query) =>
    this.call<T>("PATCH", path, { json, query });
  delete = <T = void>(path: string, query?: Query) => this.call<T>("DELETE", path, { query });
}
