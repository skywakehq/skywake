import assert from "node:assert/strict";
import { test } from "node:test";

import { EngineError } from "@skywake/engine";

// The engine makes these with their kind; its types give only the message.
const Engine = EngineError as unknown as new (kind: string, message: string) => EngineError;
import { Hono } from "hono";

import { errorHandler } from "../src/http/errors.ts";
import { server, skip } from "./helpers.ts";

/** Every error answer has these, and the id is the one in the header. */
function structured(
  got: { status: number; body: any; headers: Headers },
  status: number,
  code: string,
) {
  assert.equal(got.status, status, JSON.stringify(got.body));
  assert.equal(typeof got.body.error, "string");
  assert.equal(got.body.code, code);
  assert.ok(got.body.request_id);
  assert.equal(got.body.request_id, got.headers.get("x-request-id"));
}

async function raw(s: Awaited<ReturnType<typeof server>>, path: string, init: RequestInit) {
  const response = await s.app.request(`/v1${path}`, init);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test("every kind of error answer is structured", { skip }, async () => {
  const s = await server({ bodyLimit: 1024 });
  const { key } = await s.ready();
  const auth = { authorization: `Bearer ${key}` };

  structured(await s.call("GET", "/nothing-here", key), 404, "not_found");
  structured(await raw(s, "/x", {}), 404, "not_found");
  structured(await s.call("GET", "/namespaces/nope", key), 404, "not_found");
  structured(await s.call("GET", "/namespaces", "sw_bad"), 401, "unauthorized");

  const wrongMethod = await s.call("PATCH", "/namespaces", key);
  structured(wrongMethod, 405, "method_not_allowed");
  assert.equal(wrongMethod.headers.get("allow"), "GET, POST");
  assert.match(wrongMethod.body.error, /takes GET or POST, not PATCH/);
  // A path with parameters is matched too.
  structured(await s.call("PUT", "/keys/some-id", key), 405, "method_not_allowed");

  const badJson = await raw(s, "/namespaces", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: "{nope",
  });
  structured(badJson, 400, "invalid");
  const notJson = await raw(s, "/namespaces", {
    method: "POST",
    headers: { ...auth, "content-type": "text/plain" },
    body: "x",
  });
  structured(notJson, 415, "unsupported_media_type");

  const invalid = await s.call("POST", "/namespaces", key, { name: "../etc" });
  structured(invalid, 400, "invalid");
  assert.equal(invalid.body.path, "name");

  structured(
    await s.call("POST", "/namespaces", key, { name: "x".repeat(4000) }),
    413,
    "too_large",
  );

  const branch = "/namespaces/prod%2Fapp/branches";
  assert.equal((await s.call("POST", branch, key, { name: "b", from: "main" })).status, 201);
  const edit = (text: string) => ({ message: "edit", changes: [{ path: "a.txt", text }] });
  await s.call("POST", `${branch}/main/commits`, key, edit("main"));
  await s.call("POST", `${branch}/b/commits`, key, edit("b"));
  const merged = await s.call("POST", "/namespaces/prod%2Fapp/merges", key, {
    from: "b",
    into: "main",
  });
  structured(merged, 409, "conflict");
  assert.equal(merged.body.head, null);
  assert.ok(merged.body.conflicts.length > 0);

  const limiting = await server({ rateLimit: 1, trustProxy: 1 });
  const from = { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.7` };
  await limiting.call("GET", "/regions", undefined, undefined, from);
  structured(
    await limiting.call("GET", "/regions", undefined, undefined, from),
    429,
    "rate_limited",
  );
});

test("engine errors keep their kind as the code", async () => {
  const app = new Hono();
  app.use((c, next) => {
    c.set("requestId" as never, "req-1" as never);
    return next();
  });
  app.get("/:kind", (c) => {
    throw new Engine(c.req.param("kind"), "from the engine");
  });
  app.onError(errorHandler(() => {}));
  const answer = async (kind: string) => {
    const response = await app.request(`/${kind}`);
    return [response.status, await response.json()];
  };
  const body = (code: string, error = "from the engine") => ({ error, code, request_id: "req-1" });
  assert.deepEqual(await answer("not_found"), [404, body("not_found")]);
  assert.deepEqual(await answer("conflict"), [409, body("conflict")]);
  assert.deepEqual(await answer("invalid"), [400, body("invalid")]);
  assert.deepEqual(await answer("unavailable"), [503, body("unavailable")]);
  assert.deepEqual(await answer("busy"), [429, body("rate_limited")]);
  assert.deepEqual(await answer("internal"), [500, body("internal", "internal error")]);
});
