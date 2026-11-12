import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";

import { listen, peerPair, type Server, shut, skip } from "./helpers.ts";

const TOKEN = "peer-token-for-build-tests-01234";
const SHARDS = 16;
const SCHEMA = { vectors: [{ name: "v", dims: 2 }] };

async function pair(t: TestContext) {
  const [a, b] = await peerPair(TOKEN);
  const http = await Promise.all([a, b].map(listen));
  // Both beat before either reads the list, so each sees the other.
  for (const s of [a, b]) await s.services.pinning.tick();
  for (const s of [a, b]) await s.services.pinning.tick();
  t.after(async () => {
    for (const s of [a, b]) await s.services.pinning.stop();
    for (const listening of http) shut(listening);
  });
  const { key } = await a.org();
  return { a, b, key };
}

async function writtenIndex(s: Server, key: string, name: string) {
  const made = await s.call("POST", "/indexes", key, { name, schema: SCHEMA, shards: SHARDS });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const wrote = await s.call("POST", `/indexes/${name}/branches/main/documents`, key, {
    documents: [{ id: 1, vectors: { v: [1, 0] } }],
  });
  assert.equal(wrote.status, 200, JSON.stringify(wrote.body));
  const caller = (await s.services.auth.caller(key))!;
  return (await s.services.access.index(caller, name, "admin")).folder;
}

async function until(done: () => boolean, tries: number) {
  for (let i = 0; i < tries && !done(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("a write on one server has each shard built by exactly one server", { skip }, async (t) => {
  const { a, b, key } = await pair(t);
  const folder = await writtenIndex(a, key, "split");
  const building = () => [a, b].map((s) => s.services.builds!.building(folder, "main"));
  await until(() => building().flat().length === SHARDS, 50);
  const [onA = [], onB = []] = building();
  assert.ok(onA.length > 0 && onB.length > 0, `a builds ${onA}, b builds ${onB}`);
  const all = [...onA, ...onB].sort((x, y) => x - y);
  assert.deepEqual(all, [...Array(SHARDS).keys()], "every shard once");

  const found = await b.call("POST", "/indexes/split/branches/main/query", key, {
    vector: { column: "v", value: [1, 0] },
    topK: 1,
  });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.equal(found.body.hits.length, 1);
});

test("a server that can't be told leaves its shards to the writer", { skip }, async (t) => {
  const { a, b, key } = await pair(t);
  b.services.config.peer.url = "http://127.0.0.1:9";
  await b.services.pinning.tick();
  await a.services.pinning.tick();
  const folder = await writtenIndex(a, key, "alone");
  const onA = () => a.services.builds!.building(folder, "main").length;
  await until(() => onA() === SHARDS, 100);
  assert.equal(onA(), SHARDS);
});
