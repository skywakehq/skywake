// The HTTP API as a black box. Point SKYWAKE_API at its base URL, with any
// version prefix (such as http://localhost:3000/v1), and SKYWAKE_ADMIN at
// its admin token. Every server we ship must pass the same tests.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = process.env.SKYWAKE_API ?? "http://localhost:8080";
export const ADMIN = process.env.SKYWAKE_ADMIN ?? "";

/** The namespace most tests use, as it appears in a path. */
export const NS = "/namespaces/prod%2Fapp";

export type Reply = { status: number; body: any };

export async function call(
  method: string,
  path: string,
  key: string,
  body?: unknown,
): Promise<Reply> {
  const response = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not every reply has a JSON body.
  }
  return { status: response.status, body: parsed };
}

export const get = (path: string, key: string) => call("GET", path, key);
export const post = (path: string, key: string, body: unknown) => call("POST", path, key, body);

/** The raw bytes of a reply that must succeed. */
export async function bytes(path: string, key: string): Promise<Buffer> {
  const response = await fetch(base + path, { headers: { authorization: `Bearer ${key}` } });
  assert.equal(response.status, 200, path);
  return Buffer.from(await response.arrayBuffer());
}

export const unique = () => randomBytes(8).toString("hex");
export const enc = (name: string) => name.replaceAll("/", "%2F");
export const names = (list: any[], field: string) => list.map((item) => item[field]);

/** A new organization. Returns its admin key. */
export async function org(): Promise<string> {
  const { status, body } = await post("/orgs", ADMIN, { name: `o-${unique()}` });
  assert.equal(status, 201, JSON.stringify(body));
  return body.key;
}

/** An organization with namespace `prod/app` and an empty `main`. */
export async function ready(): Promise<string> {
  const key = await org();
  assert.equal((await post("/namespaces", key, { name: "prod/app" })).status, 201);
  assert.equal((await post(`${NS}/branches`, key, { name: "main" })).status, 201);
  return key;
}

export async function key(admin: string, role: string, namespaces: string): Promise<string> {
  const { status, body } = await post("/keys", admin, { name: "test", role, namespaces });
  assert.equal(status, 201, JSON.stringify(body));
  return body.key;
}

/** Writes text files on `branch` as one commit. */
export function write(key: string, branch: string, files: Record<string, string>): Promise<Reply> {
  const changes = Object.entries(files).map(([path, text]) => ({ path, text }));
  return post(`${NS}/branches/${enc(branch)}/commits`, key, { message: "write", changes });
}
