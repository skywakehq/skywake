// The HTTP API as a black box. Point SKYWAKE_API at its base URL, with any
// version prefix (such as http://localhost:3000/v1), and SKYWAKE_ADMIN at
// its admin token. Every server we ship must pass the same tests.

import { randomBytes } from "node:crypto";

const base = process.env.SKYWAKE_API ?? "http://localhost:8080";
export const ADMIN = process.env.SKYWAKE_ADMIN ?? "";

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

export const unique = () => randomBytes(8).toString("hex");
