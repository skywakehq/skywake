import assert from "node:assert/strict";
import { test } from "node:test";

import { indexUsage } from "../src/db/schema.ts";
import { invoices, PRICES, type UsageRow } from "../src/features/orgs/invoices.ts";
import { ADMIN, server, skip, token, unique } from "./helpers.ts";

const SCHEMA = { vectors: [{ name: "v", dims: 2, metric: "euclidean" }] };
const from = (ip: string) => ({ "x-forwarded-for": ip });

test("an org admin limits where the organization is called from", { skip }, async () => {
  const s = await server({ trustProxy: 1 });
  const { id, key } = await s.org();
  const office = from("203.0.113.9");
  const call = (method: string, path: string, who: string, body?: unknown, ip = office) =>
    s.call(method, path, who, body, ip);
  const list = `/orgs/${id}/ip-allowlist`;

  assert.deepEqual((await call("GET", list, key)).body, { cidrs: [] });
  // Anywhere is fine while the list is empty.
  assert.equal(
    (await call("GET", "/namespaces", key, undefined, from("198.51.100.1"))).status,
    200,
  );

  const bad = await call("PUT", list, key, { cidrs: ["203.0.113.0/24", "10.0.0.0/33"] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.path, "cidrs[1]");

  const lockout = await call("PUT", list, key, { cidrs: ["198.51.100.0/24"] });
  assert.equal(lockout.status, 409);
  assert.match(lockout.body.error, /lock you out.*203\.0\.113\.9/);

  const cidrs = ["203.0.113.0/24", "2001:db8::/32", "203.0.113.0/24"];
  const set = await call("PUT", list, key, { cidrs });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.cidrs, ["203.0.113.0/24", "2001:db8::/32"]);

  const status = async (ip: string, who = key) =>
    (await call("GET", "/namespaces", who, undefined, from(ip))).status;
  assert.equal(await status("203.0.113.200"), 200);
  assert.equal(await status("::ffff:203.0.113.5"), 200);
  assert.equal(await status("2001:db8:1::5"), 200);
  const refused = await call("GET", "/namespaces", key, undefined, from("198.51.100.1"));
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "ip_not_allowed");
  assert.match(refused.body.error, /198\.51\.100\.1/);
  assert.equal(await status("2001:db9::1"), 403);

  // A console token is checked at the address the console saw, not the console's own.
  const person = (ip: string) => token(id, "owner", "test", "1m", { ip });
  assert.equal(await status("198.51.100.1", await person("203.0.113.4")), 200);
  assert.equal(await status("203.0.113.4", await person("198.51.100.1")), 403);

  // Only admins of the organization see or change it.
  const member = await token(id, "member", "test", "1m", { ip: "203.0.113.4" });
  assert.equal((await call("GET", list, member)).status, 403);
  const other = await s.org();
  assert.equal((await call("GET", list, other.key)).status, 404);

  assert.equal((await call("PUT", list, key, { cidrs: [] })).status, 200);
  assert.equal(await status("198.51.100.1"), 200);
  const events = (await call("GET", "/audit?action=setIpAllowlist&outcome=ok", key)).body.events;
  assert.deepEqual(
    events.slice(0, 2).map((e: any) => e.details.cidrs),
    [[], ["203.0.113.0/24", "2001:db8::/32"]],
  );
});

test("an index is copied to another organization of the same person", { skip }, async () => {
  const s = await server();
  const source = await s.org();
  const target = await s.org();
  assert.equal(
    (await s.call("POST", "/indexes", source.key, { name: "docs", schema: SCHEMA })).status,
    201,
  );
  const docs = [{ id: 1, vectors: { v: [1, 2] } }];
  await s.call("POST", "/indexes/docs/branches/main/documents", source.key, { documents: docs });
  const copy = (who: string, body: object = {}) =>
    s.call("POST", "/indexes/docs/copy", who, { name: "docs", target_org: target.id, ...body });

  const byKey = await copy(source.key);
  assert.equal(byKey.status, 403);
  assert.match(byKey.body.error, /API key belongs to one organization/);

  const both = (role: string) =>
    token(source.id, "owner", "test", "1m", { orgs: { [target.id]: role } });
  assert.equal((await copy(await token(source.id, "owner"))).status, 404);
  assert.equal((await copy(await both("member"))).status, 403);
  const reader = await token(source.id, "read", "test", "1m", { orgs: { [target.id]: "owner" } });
  assert.equal((await copy(reader)).status, 403);

  const made = await copy(await both("owner"));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const got = await s.call("GET", "/indexes/docs/branches/main/documents/1", target.key);
  assert.equal(got.status, 200, JSON.stringify(got.body));
  assert.equal((await s.call("GET", "/indexes/docs", source.key)).status, 200);

  // One event, in both organizations' logs.
  const copies = async (key: string) =>
    (await s.call("GET", "/audit?action=copyIndex&outcome=ok", key)).body.events.map((e: any) => [
      e.id,
      e.org,
      e.owner,
      e.details.to,
    ]);
  assert.deepEqual(await copies(source.key), [
    [(await copies(target.key))[0][0], source.id, target.id, "docs"],
  ]);
  assert.deepEqual(await copies(source.key), await copies(target.key));
});

const row = (index: string, day: string, values: Partial<UsageRow> = {}): UsageRow => ({
  index,
  day,
  embeddings: 0,
  reranks: 0,
  bytes: null,
  pinnedMs: 0,
  bytesWritten: 0,
  bytesScanned: 0,
  ...values,
});

const GB = 2 ** 30;
const TB = 2 ** 40;

test("invoices charge by bytes and prorate storage by the day", () => {
  const rows = [
    row("a", "2026-09-30", { bytesScanned: 2 * TB, bytes: 10 * GB }),
    // No size counted in October: September's last one holds.
    row("a", "2026-10-15", { bytesWritten: 3 * GB }),
    // Created on the 21st of November with 3 GB, grown to 6 GB on the 26th.
    row("b", "2026-11-21", { embeddings: 1000, bytes: 3 * GB }),
    row("b", "2026-11-26", { reranks: 5, bytes: 6 * GB }),
  ];
  const all = invoices(rows, PRICES, "2026-11-30");
  assert.deepEqual(
    all.map((invoice) => [invoice.month, invoice.status]),
    [
      ["2026-11", "open"],
      ["2026-10", "closed"],
      ["2026-09", "closed"],
    ],
  );
  const [november, october, september] = all;

  // One day of 10 GB in a 30-day month: a third of a GB-month.
  assert.deepEqual(september!.lines, [
    { index: "a", item: "storage", quantity: 0.333333, unit_price: 0.25, amount_cents: 8 },
    { index: "a", item: "queries", quantity: 2, unit_price: 0.000732421875, amount_cents: 0 },
  ]);

  assert.deepEqual(october!.lines, [
    { index: "a", item: "storage", quantity: 10, unit_price: 0.25, amount_cents: 250 },
    { index: "a", item: "writes", quantity: 3, unit_price: 1.5, amount_cents: 450 },
  ]);
  assert.equal(october!.total_cents, 700);

  // a: 30 days of 10 GB. b: 5 days of 3 GB and 5 of 6 GB = 45 GB-days of 30.
  const storage = november!.lines.filter((line) => line.item === "storage");
  assert.deepEqual(
    storage.map((line) => [line.index, line.quantity, line.amount_cents]),
    [
      ["a", 10, 250],
      ["b", 1.5, 38],
    ],
  );
  const b = november!.lines.filter((line) => line.index === "b");
  assert.deepEqual(
    b.map((line) => [line.item, line.quantity, line.amount_cents]),
    [
      ["storage", 1.5, 38],
      ["embeddings", 1000, 1],
      ["reranks", 5, 0],
    ],
  );
  assert.equal(november!.total_cents, 250 + 38 + 1 + 0);

  // Mid-month, the open invoice counts only the days so far.
  const early = invoices(rows, PRICES, "2026-11-10")[0]!;
  assert.deepEqual(
    early.lines.map((line) => [line.index, line.item, line.quantity, line.amount_cents]),
    [["a", "storage", 3.333333, 83]],
  );

  const priced = invoices(rows, { ...PRICES, writes: "2.00" }, "2026-11-30");
  assert.equal(priced[1]!.lines[1]!.amount_cents, 600);
});

test("a pinned index pays per GB-hour of each replica", () => {
  const HOUR = 3_600_000;
  const rows = [
    // Two replicas all day over 2 GB, then one replica for 12 hours over 4 GB.
    row("p", "2026-11-01", { bytes: 2 * GB, pinnedMs: 2 * 24 * HOUR }),
    row("p", "2026-11-02", { bytes: 4 * GB, pinnedMs: 12 * HOUR }),
  ];
  const [november] = invoices(rows, { ...PRICES, pinned: "0.01" }, "2026-11-02");
  const pinned = november!.lines.find((line) => line.item === "pinned");
  // 2 GB × 48 replica-hours + 4 GB × 12 = 144 GB-hours at a cent each.
  assert.deepEqual(pinned, {
    index: "p",
    item: "pinned",
    quantity: 144,
    unit_price: 0.01,
    amount_cents: 144,
  });
});

test("an org admin reads the organization's invoices", { skip }, async () => {
  const s = await server({ prices: { writes: "10" } });
  const { id, key } = await s.org();
  assert.equal(
    (await s.call("POST", "/indexes", key, { name: "docs", schema: SCHEMA })).status,
    201,
  );
  const today = new Date().toISOString().slice(0, 10);
  await s.db
    .insert(indexUsage)
    .values({ org: id, index: "docs", day: today, bytesWritten: Math.round(1.234 * GB) });

  const listed = await s.call("GET", `/orgs/${id}/invoices`, key);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const month = today.slice(0, 7);
  assert.deepEqual(listed.body, [{ month, status: "open", currency: "usd", total_cents: 1234 }]);

  const one = await s.call("GET", `/orgs/${id}/invoices/${month}`, key);
  assert.deepEqual(one.body.lines, [
    { index: "docs", item: "writes", quantity: 1.234, unit_price: 10, amount_cents: 1234 },
  ]);
  assert.equal((await s.call("GET", `/orgs/${id}/invoices/2001-01`, key)).status, 404);
  assert.equal((await s.call("GET", `/orgs/${id}/invoices/2001-13`, key)).status, 400);
  const member = await token(id, "member");
  assert.equal((await s.call("GET", `/orgs/${id}/invoices`, member)).status, 403);
});

test("organization names are unique whatever the case, by either path", { skip }, async () => {
  const s = await server();
  const name = `Acme ${unique()}`;
  assert.equal((await s.call("POST", "/orgs", ADMIN, { name })).status, 201);
  const shouted = await s.call("POST", "/orgs", ADMIN, { name: name.toUpperCase() });
  assert.equal(shouted.status, 409, JSON.stringify(shouted.body));
  // As the console registers one, with its own id.
  const fromConsole = await s.call("POST", "/orgs", ADMIN, {
    name: name.toLowerCase(),
    id: `c_${unique()}`,
  });
  assert.equal(fromConsole.status, 409, JSON.stringify(fromConsole.body));
});

test("the operator renames an organization, never onto a taken name", { skip }, async () => {
  const s = await server();
  const first = await s.org();
  const second = await s.org();
  const name = `Named ${unique()}`;
  const path = (org: string) => `/orgs/${org}/name`;
  assert.equal((await s.call("PUT", path(first.id), first.key, { name })).status, 401);
  const renamed = await s.call("PUT", path(first.id), ADMIN, { name });
  assert.deepEqual([renamed.status, renamed.body], [200, { id: first.id, name }]);
  assert.equal((await s.call("PUT", path(first.id), ADMIN, { name })).status, 200);
  assert.equal(
    (await s.call("PUT", path(second.id), ADMIN, { name: name.toUpperCase() })).status,
    409,
  );
  assert.equal((await s.call("PUT", path("org_missing"), ADMIN, { name: "x" })).status, 404);
});
