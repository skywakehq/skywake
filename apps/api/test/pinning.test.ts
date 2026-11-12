import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { indexUsage, peers } from "../src/db/schema.ts";
import { Stores } from "../src/engine/stores.ts";
import { place } from "../src/features/pinning/placement.ts";
import { SERVER_HEADER } from "../src/http/peers.ts";
import { database, listen, server, skip } from "./helpers.ts";

const SCHEMA = { vectors: [{ name: "embedding", dims: 2, metric: "euclidean" }] };
const DOCS = [0, 1, 2, 3].map((id) => ({ id, vectors: { embedding: [id, 0] } }));
const IX = "/indexes/hot";
const QUERY = { vector: { column: "embedding", value: [0, 0] }, topK: 2 };
const TOKEN = "peer-token-0123456789";

const ids = (n: number, prefix = "server") =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));
const keys = Array.from({ length: 2000 }, (_, i) => `ix_${i}`);
const placed = (servers: { id: string }[], n: number) =>
  keys.map((key) => place(key, servers, n).map((server) => server.id));

test("placement is the same whatever order the servers are listed in", () => {
  const servers = ids(5);
  assert.deepEqual(placed(servers, 2), placed(servers.toReversed(), 2));
  for (const replicas of placed(servers, 3)) assert.equal(new Set(replicas).size, 3);
  assert.deepEqual(place("ix_0", ids(2), 8).length, 2);
});

test("placement spreads indexes and moves few when a server comes or goes", () => {
  const before = placed(ids(4), 1).map(([id]) => id);
  const counts = Map.groupBy(before, (id) => id);
  for (const [, mine] of counts) assert.ok(mine.length > 350 && mine.length < 650);

  // A fifth server takes about a fifth of the indexes, and only those move.
  const grown = placed(ids(5), 1).map(([id]) => id);
  const moved = before.filter((id, i) => id !== grown[i]);
  assert.ok(moved.length > 250 && moved.length < 550, `${moved.length} moved`);
  assert.ok(grown.every((id, i) => id === before[i] || id === "server-4"));

  // A server that goes moves only its own indexes; the others keep theirs.
  const shrunk = placed(
    ids(4).filter(({ id }) => id !== "server-1"),
    1,
  ).map(([id]) => id);
  assert.ok(before.every((id, i) => id === "server-1" || shrunk[i] === id));
});

test("a held index stays open however many others are opened", () => {
  const store = mkdtempSync(join(tmpdir(), "skywake-held-"));
  const stores = new Stores([["local", store]], 2);
  const held = stores.index("local", "held");
  stores.hold("held");
  for (const folder of ["a", "b", "c"]) stores.index("local", folder);
  assert.equal(stores.index("local", "held"), held);
  stores.release("held");
  for (const folder of ["d", "e"]) stores.index("local", folder);
  assert.notEqual(stores.index("local", "held"), held);
});

// Servers of an earlier run may still look alive; placement here counts only this test's.
beforeEach(async () => {
  if (!skip) await (await database()).delete(peers);
});

async function pinnedServer(overrides = {}) {
  const s = await server({ peer: { url: "http://127.0.0.1:0", token: TOKEN }, ...overrides });
  const { id, key } = await s.org();
  return { s, org: id, key };
}

test("pinning is set at create, changed by update, shown, and not copied", { skip }, async () => {
  const { s, key } = await pinnedServer();
  const bad = await s.call("POST", "/indexes", key, {
    name: "hot",
    schema: SCHEMA,
    pinned: { replicas: 9 },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.path, "pinned.replicas");

  const made = await s.call("POST", "/indexes", key, {
    name: "hot",
    schema: SCHEMA,
    pinned: { replicas: 2 },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(made.body.pinned, { replicas: 2 });

  await s.services.pinning.tick();
  const info = await s.call("GET", IX, key);
  assert.deepEqual(info.body.pinning, {
    replicas: [{ server: s.services.pinning.id, warm: true, in_flight: 0 }],
  });

  const zero = await s.call("PATCH", IX, key, { pinned: { replicas: 0 } });
  assert.equal(zero.status, 400);
  const changed = await s.call("PATCH", IX, key, { pinned: { replicas: 3 } });
  assert.deepEqual(changed.body.pinned, { replicas: 3 });
  const kept = await s.call("PATCH", IX, key, { read_only: false });
  assert.deepEqual(kept.body.pinned, { replicas: 3 });

  const copy = await s.call("POST", `${IX}/copy`, key, { name: "cold" });
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.equal(copy.body.pinned, null);
  assert.equal((await s.call("GET", "/indexes/cold", key)).body.pinning, null);

  const unpinned = await s.call("PATCH", IX, key, { pinned: null });
  assert.equal(unpinned.body.pinned, null);
  assert.equal((await s.call("GET", IX, key)).body.pinning, null);
  await s.services.pinning.stop();
});

test(
  "a pinned index is warmed again when it changes, and billed by the hour",
  { skip },
  async () => {
    const { s, org, key } = await pinnedServer();
    await s.call("POST", "/indexes", key, { name: "hot", schema: SCHEMA, pinned: { replicas: 1 } });
    await s.call("POST", `${IX}/branches/main/documents`, key, { documents: DOCS });
    await s.services.pinning.tick();
    await s.call("POST", `${IX}/branches/main/documents`, key, { documents: DOCS.slice(0, 1) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await s.services.pinning.tick();
    const { replicas } = (await s.call("GET", IX, key)).body.pinning;
    assert.equal(replicas[0].warm, true);

    const answered = await s.call("POST", `${IX}/branches/main/query`, key, QUERY);
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    assert.equal(answered.headers.get(SERVER_HEADER), s.services.pinning.id);
    assert.equal(answered.body.billing.queries, undefined);
    assert.notEqual(answered.body.performance.cache_temperature, "cold");

    await s.services.usage.flush();
    const [day] = await s.db.select().from(indexUsage).where(eq(indexUsage.org, org));
    assert.ok(day!.pinnedMs >= 50, `${day!.pinnedMs} ms`);
    assert.ok(day!.bytes! > 0);
    await s.call("DELETE", IX, key);
    await s.services.pinning.stop();
  },
);

test("a query goes to the replica, or is answered here when none answers", { skip }, async () => {
  const one = await pinnedServer();
  const other = await server({
    regions: one.s.services.config.regions,
    peer: { url: "http://127.0.0.1:0", token: TOKEN },
  });
  const listening = await Promise.all([one.s, other].map(listen));
  const { key } = one;
  await one.s.call("POST", "/indexes", key, {
    name: "hot",
    schema: SCHEMA,
    pinned: { replicas: 1 },
  });
  await one.s.call("POST", `${IX}/branches/main/documents`, key, { documents: DOCS });
  for (const s of [one.s, other, one.s]) await s.services.pinning.tick();

  const folder = one.s.services.pinning.pinned(one.org, "hot")!.folder;
  const replica = one.s.services.pinning.holds(folder) ? one.s : other;
  const elsewhere = replica === one.s ? other : one.s;
  const sent = await elsewhere.call("POST", `${IX}/branches/main/query`, key, QUERY);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.headers.get(SERVER_HEADER), replica.services.pinning.id);
  assert.deepEqual(
    sent.body.hits.map((hit: { id: number }) => hit.id),
    [0, 1],
  );

  // The replica stops; until the others notice, this server answers itself.
  await new Promise<void>((resolve) =>
    listening[replica === one.s ? 0 : 1]!.close(() => resolve()),
  );
  const fallback = await elsewhere.call("POST", `${IX}/branches/main/query`, key, QUERY);
  assert.equal(fallback.status, 200, JSON.stringify(fallback.body));
  assert.equal(fallback.headers.get(SERVER_HEADER), elsewhere.services.pinning.id);

  await one.s.call("DELETE", IX, key);
  for (const s of [one.s, other]) await s.services.pinning.stop();
  for (const http of listening) http.close();
});

test("a request with the wrong peer token is routed like any other", { skip }, async () => {
  const { s } = await pinnedServer();
  assert.equal(s.services.pinning.admits(TOKEN), true);
  assert.equal(s.services.pinning.admits("peer-token-wrong-456789"), false);
  assert.equal(s.services.pinning.admits(undefined), false);
  const lone = await server();
  assert.equal(lone.services.pinning.admits(TOKEN), false);
});
