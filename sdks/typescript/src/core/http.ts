import { errorOf } from "./errors.js";

type Value = string | number | boolean | undefined | null;
export type Query = Record<string, Value>;

export interface Request {
  query?: Query;
  json?: unknown;
  bytes?: Uint8Array;
}

// A URL drops `.` and `..` parts, so such a part would climb out of the disk's own path.
function part(name: string) {
  if (name === "." || name === "..") throw new TypeError(`\`${name}\` can't be part of a path`);
  return encodeURIComponent(name);
}

export const segment = (name: string) => part(name);
export const filePath = (path: string) => path.replace(/^\/+/, "").split("/").map(part).join("/");

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

  async raw(method: string, path: string, request: Request = {}): Promise<Response> {
    const url = new URL(this.#base + path);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
    const headers = new Headers(this.#headers);
    let body: BodyInit | undefined;
    if (request.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(request.json);
    } else if (request.bytes !== undefined) {
      headers.set("content-type", "application/octet-stream");
      body = request.bytes as BodyInit;
    }
    const response = await this.#fetch(new globalThis.Request(url, { method, headers, body }));
    if (response.ok) return response;
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    throw errorOf(response, parsed);
  }

  async call<T>(method: string, path: string, request: Request = {}): Promise<T> {
    const response = await this.raw(method, path, request);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get = <T>(path: string, query?: Query) => this.call<T>("GET", path, { query });
  post = <T>(path: string, json: unknown = {}, query?: Query) =>
    this.call<T>("POST", path, { json, query });
  patch = <T>(path: string, json: unknown, query?: Query) =>
    this.call<T>("PATCH", path, { json, query });
  delete = <T = void>(path: string, query?: Query) => this.call<T>("DELETE", path, { query });
}
