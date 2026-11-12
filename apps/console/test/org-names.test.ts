import assert from "node:assert/strict";
import { test } from "node:test";

import { alignNames, renameFirst, reserveOrg } from "../server/org-names.ts";

process.env.SKYWAKE_API_URL = "http://api.test/v1";
process.env.SKYWAKE_API_ADMIN_TOKEN = "admin-token";

test("a new organization is registered under its own name before it is made", async () => {
  let sent: { url: string; body: { id: string; name: string } } | null = null;
  const send = (async (url: string, init?: RequestInit) => {
    sent = { url, body: JSON.parse(String(init?.body)) };
    return Response.json({ id: "x", key: null }, { status: 201 });
  }) as typeof fetch;
  const id = await reserveOrg("Acme", send);
  assert.equal(sent!.url, "http://api.test/v1/orgs");
  assert.deepEqual(sent!.body, { id, name: "Acme" });
  assert.match(id, /^[A-Za-z0-9_-]{32}$/);
});

test("a name the API already has stops the organization", async () => {
  const taken = (async () => Response.json({ error: "exists" }, { status: 409 })) as typeof fetch;
  await assert.rejects(reserveOrg("acme", taken), /named “acme” exists/);
});

test("a rename goes to the API first, and a taken name stops it", async () => {
  const sent: string[] = [];
  const send = (async (url: string, init?: RequestInit) => {
    const { name } = JSON.parse(String(init?.body));
    sent.push(`${init?.method} ${url} ${name}`);
    return name === "Taken" ? new Response("exists", { status: 409 }) : Response.json({ name });
  }) as typeof fetch;
  await renameFirst("org1", { name: "Fresh" }, send);
  await assert.rejects(renameFirst("org1", { name: "Taken" }, send), /named “Taken” exists/);
  await renameFirst("org1", { logo: "x.png" }, send);
  assert.deepEqual(sent, [
    "PUT http://api.test/v1/orgs/org1/name Fresh",
    "PUT http://api.test/v1/orgs/org1/name Taken",
  ]);
});

test("names reach the API, and a taken one becomes Name 2 on both sides", async () => {
  const taken = new Set(["acme"]);
  const sent: string[] = [];
  const send = (async (url: string, init?: RequestInit) => {
    const { name } = JSON.parse(String(init?.body));
    sent.push(`${url} ${name}`);
    if (taken.has(name.toLowerCase())) return new Response("taken", { status: 409 });
    taken.add(name.toLowerCase());
    return Response.json({ name });
  }) as typeof fetch;
  const renamed: { id: string; name: string }[] = [];
  const changed = await alignNames(
    [
      { id: "a", name: "Beta" },
      { id: "b", name: "Acme" },
    ],
    async (org) => renamed.push(org),
    send,
  );
  assert.deepEqual(sent, [
    "http://api.test/v1/orgs/a/name Beta",
    "http://api.test/v1/orgs/b/name Acme",
    "http://api.test/v1/orgs/b/name Acme 2",
  ]);
  assert.deepEqual(changed, [{ id: "b", name: "Acme 2" }]);
  assert.deepEqual(renamed, changed);
});
