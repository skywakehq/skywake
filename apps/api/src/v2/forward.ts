import { BASE_PATH } from "@skywake/contract";
import { Hono } from "hono";

import { auditTrail } from "../audit/middleware.ts";
import type { Api, AppEnv, Ctx, Services } from "../http/context.ts";
import { Failure } from "./errors.ts";

const PASSED = [
  "authorization",
  "skywake-environment",
  "user-agent",
  "x-request-id",
  "x-forwarded-for",
];

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface Call {
  query?: Query;
  json?: unknown;
  bytes?: ArrayBuffer | Uint8Array;
}

export interface Forwarded {
  status: number;
  headers: Headers;
  body: unknown;
}

interface Passed {
  requestId: string;
  again: boolean;
  json?: unknown;
}

export interface Inner {
  fetch(request: Request, env: unknown): Response | Promise<Response>;
}

export function innerApp(services: Services, api: Api): Inner {
  const inner = new Hono<AppEnv>();
  inner.use(async (c, next) => {
    const from = (c.env as { skywake?: Passed } | undefined)?.skywake;
    if (from?.json !== undefined) {
      const json = from.json;
      c.req.json = <T>() => Promise.resolve(json as T);
      c.req.text = () => Promise.resolve(JSON.stringify(json));
    }
    c.set("requestId", from?.requestId ?? crypto.randomUUID());
    c.set("fromPeer", false);
    c.set("again", from?.again ?? false);
    await next();
  });
  inner.use(`${BASE_PATH}/*`, auditTrail(services));
  inner.route(BASE_PATH, api);
  return inner;
}

export const segment = (part: string) => encodeURIComponent(part);

export class V1 {
  readonly #c: Ctx;
  readonly #inner: Inner;
  #calls = 0;

  constructor(c: Ctx, inner: Inner) {
    this.#c = c;
    this.#inner = inner;
  }

  async raw(method: string, path: string, call: Call = {}): Promise<Response> {
    const url = new URL(`http://internal${BASE_PATH}${path}`);
    for (const [name, value] of Object.entries(call.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
    const headers = new Headers();
    for (const name of PASSED) {
      const value = this.#c.req.header(name);
      if (value !== undefined) headers.set(name, value);
    }
    let body: BodyInit | undefined;
    if (call.json !== undefined) {
      headers.set("content-type", "application/json");
    } else if (call.bytes !== undefined) {
      headers.set("content-type", "application/octet-stream");
      body = call.bytes as BodyInit;
    }
    const skywake: Passed = {
      requestId: this.#c.get("requestId"),
      again: this.#calls++ > 0,
      json: call.json,
    };
    const env = { ...(this.#c.env as object), skywake };
    return this.#inner.fetch(new Request(url, { method, headers, body }), env);
  }

  async call<T = unknown>(method: string, path: string, call: Call = {}): Promise<T> {
    return (await this.send(method, path, call)).body as T;
  }

  async send(method: string, path: string, call: Call = {}): Promise<Forwarded> {
    const response = await this.raw(method, path, call);
    const text = await response.text();
    const body = text ? parse(text) : null;
    if (!response.ok) throw Failure.from(response.status, body, response.headers);
    return { status: response.status, headers: response.headers, body };
  }

  get = <T = unknown>(path: string, query?: Query) => this.call<T>("GET", path, { query });
  post = <T = unknown>(path: string, json?: unknown, query?: Query) =>
    this.call<T>("POST", path, { json: json ?? {}, query });
  patch = <T = unknown>(path: string, json: unknown, query?: Query) =>
    this.call<T>("PATCH", path, { json, query });
  put = <T = unknown>(path: string, json: unknown, query?: Query) =>
    this.call<T>("PUT", path, { json, query });
  delete = <T = unknown>(path: string, query?: Query) => this.call<T>("DELETE", path, { query });
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
