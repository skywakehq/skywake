import assert from "node:assert/strict";
import { test } from "node:test";

import { server, skip } from "./helpers.ts";

test("every request is logged as one structured line", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.org();
  const listed = await s.call("GET", "/namespaces", key);
  const line = s.logs.find((entry) => entry.request_id === listed.headers.get("x-request-id"));
  assert.ok(line);
  assert.equal(line.msg, "request");
  assert.equal(line.method, "GET");
  assert.equal(line.route, "/v1/namespaces");
  assert.equal(line.status, 200);
  assert.equal(line.org, id);
  assert.match(String(line.actor), /^key:/);
  assert.equal(typeof line.seconds, "number");
  assert.ok(!JSON.stringify(s.logs).includes(key), "the key is never logged");
});

test(
  "the request id is always the server's own; the client's is logged beside it",
  { skip },
  async () => {
    const s = await server();
    const { key } = await s.org();
    const listed = await s.call("GET", "/namespaces", key, undefined, { "x-request-id": "forged" });
    const id = listed.headers.get("x-request-id");
    assert.ok(id && id !== "forged");
    const line = s.logs.find((entry) => entry.request_id === id);
    assert.equal(line?.client_request_id, "forged");
  },
);

test(
  "an unexpected error is logged with its request id, and the answer says little",
  { skip },
  async () => {
    const s = await server();
    const { key } = await s.ready();
    const stores = s.services.stores;
    stores.engine = () => {
      throw new Error("the disk caught fire");
    };
    const failed = await s.call("GET", "/namespaces/prod%2Fapp/branches/main/files", key);
    const requestId = failed.headers.get("x-request-id");
    assert.deepEqual(failed.body, {
      error: "internal error",
      code: "internal",
      request_id: requestId,
    });
    const logged = s.logs.find((entry) => entry.msg === "request failed");
    assert.ok(logged);
    assert.equal(logged.level, "error");
    assert.equal(logged.request_id, requestId);
    assert.equal(logged.error, "the disk caught fire");
  },
);

test("the server says when it is alive and when it is ready", { skip }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const s = await server();
  let checks = 0;
  const check = s.services.stores.check.bind(s.services.stores);
  s.services.stores.check = () => (checks++, check());
  assert.deepEqual(await (await s.app.request("/health")).json(), { ok: true });
  const ready = await s.app.request("/ready");
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ok: true, failed: [] });

  // Checks cost a query and a bucket listing, so a flood of them is answered from the last one.
  s.services.stores.check = () => (checks++, Promise.reject(new Error("no bucket")));
  assert.equal((await s.app.request("/ready")).status, 200);
  assert.equal(checks, 1);

  t.mock.timers.tick(5001);
  const notReady = await s.app.request("/ready");
  assert.equal(notReady.status, 503);
  assert.deepEqual(await notReady.json(), { ok: false, failed: ["store"] });
  assert.equal(checks, 2);
});

test("requests are counted for Prometheus, by route", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  await s.call("GET", "/namespaces", key);
  const text = await s.services.metrics.registry.metrics();
  assert.match(
    text,
    /skywake_api_requests_total\{method="GET",route="\/v1\/namespaces",status="200"\} 1/,
  );
  assert.match(
    text,
    /skywake_api_request_seconds_bucket\{le="0.005",method="GET",route="\/v1\/namespaces"\}/,
  );
});
