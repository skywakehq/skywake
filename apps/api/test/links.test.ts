import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { Engine } from "@skywake/engine";
import { sql } from "drizzle-orm";

import * as links from "../src/features/links/queries.ts";
import { docId } from "../src/features/links/sync.ts";
import { server, skip, unique, type Server } from "./helpers.ts";

const NS = "/namespaces/prod%2Fapp";

async function linked(s: Server, body: object = {}) {
  const { id, key } = await s.ready();
  const made = await s.call("PUT", `${NS}/index`, key, { index: "prod/files", ...body });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  return { id, key };
}

async function commit(s: Server, key: string, changes: object[], branch = "main") {
  const done = await s.call("POST", `${NS}/branches/${branch}/commits`, key, {
    message: "change",
    changes,
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  return done.body.head as string;
}

async function found(s: Server, key: string, query: string, branch = "main") {
  const hits = await s.call("POST", `/indexes/prod%2Ffiles/branches/${branch}/search`, key, {
    query,
  });
  assert.equal(hits.status, 200, JSON.stringify(hits.body));
  return hits.body.hits.map((hit: { id: string }) => hit.id).sort();
}

/** The namespace's engine, opened as a writer that bypasses the API would. */
async function direct(s: Server, org: string) {
  const ns = (await s.services.db.query.namespaces.findFirst({
    where: (t, { and, eq }) => and(eq(t.org, org), eq(t.name, "prod/app")),
  }))!;
  return Engine.open(join(s.store, ns.region, ns.folder));
}

test("a linked namespace's files are searchable, and follow each commit", { skip }, async () => {
  const s = await server();
  const { id, key } = await linked(s);
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "hello"), ["a.txt"]);

  await commit(s, key, [
    { path: "docs/guide.md", text: "a guide to giraffes" },
    { path: "docs/deep/notes.md", text: "giraffes again" },
    { path: "a.txt", text: "goodbye" },
  ]);
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "giraffes"), ["docs/deep/notes.md", "docs/guide.md"]);
  assert.deepEqual(await found(s, key, "hello"), []);
  assert.deepEqual(await found(s, key, "goodbye"), ["a.txt"]);

  // Removing a folder removes everything under it.
  const head = await commit(s, key, [{ path: "docs", delete: true }]);
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "giraffes"), []);

  const status = await s.call("GET", `${NS}/branches/main/index`, key);
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.synced, head);
  assert.equal(status.body.head, head);
  assert.equal(status.body.behind, false);
  assert.ok(status.body.version);
  const stamp = await links.stampOf(s.services.db, id, "prod/files", "main", head);
  assert.equal(stamp?.version, status.body.version);
});

test("a link indexes only the files its globs and size let in", { skip }, async () => {
  const s = await server();
  const { key } = await linked(s, {
    include: ["src/**"],
    exclude: ["**/*.lock"],
    maxBytes: 64,
  });
  await commit(s, key, [
    { path: "src/app.ts", text: "zebra" },
    { path: "src/yarn.lock", text: "zebra" },
    { path: "src/big.txt", text: `zebra ${"x".repeat(100)}` },
    { path: "src/bin.dat", base64: Buffer.from([0x7a, 0, 1, 2]).toString("base64") },
    { path: "other.txt", text: "zebra" },
  ]);
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "zebra"), ["src/app.ts"]);

  // Changed globs index the files again.
  const relinked = await s.call("PUT", `${NS}/index`, key, { index: "prod/files" });
  assert.equal(relinked.status, 200);
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "zebra"), [
    "other.txt",
    "src/app.ts",
    "src/big.txt",
    "src/yarn.lock",
  ]);
});

test("saves written straight to the bucket are found", { skip }, async () => {
  const s = await server();
  const { id, key } = await linked(s);
  await s.services.syncer.drain();
  const engine = await direct(s, id);
  const db = s.services.db;
  const row = () => links.branch(db, id, "prod/app", "main");

  // A notice of a save waits, so a burst of saves is indexed once.
  await engine.commitFiles("main", "save", [{ path: "b.txt", content: Buffer.from("walrus") }]);
  for (let i = 0; i < 3; i++) {
    const noted = await s.call("POST", `${NS}/branches/main/advanced`, key);
    assert.equal(noted.status, 202);
  }
  const waiting = (await row())!;
  assert.equal(waiting.dirty, true);
  assert.ok(waiting.due.getTime() > Date.now() + 20_000);
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "walrus"), []);
  await db.execute(sql`UPDATE api.index_link_branches SET due = now() WHERE org = ${id}`);
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "walrus"), ["b.txt"]);

  // With no notice at all, the periodic check finds it.
  await engine.commitFiles("main", "save", [{ path: "c.txt", content: Buffer.from("narwhal") }]);
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "narwhal"), []);
  await db.execute(
    sql`UPDATE api.index_link_branches SET checked = now() - interval '1 hour' WHERE org = ${id}`,
  );
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "narwhal"), ["c.txt"]);
});

test("servers never claim one branch twice, and take back a lapsed claim", { skip }, async () => {
  const s = await server();
  const { id } = await linked(s);
  const db = s.services.db;
  for (const name of ["b1", "b2", "b3", "b4", "b5", "b6"]) {
    await links.addBranch(db, id, "prod/app", name, null);
  }
  const mine = sql`org = ${id}`;
  // Tests run one at a time: park what earlier ones left, so only this org is due.
  await db.execute(sql`
    UPDATE api.index_link_branches SET dirty = false, checked = now() + interval '1 hour'
    WHERE NOT (${mine})`);
  // One claim takes at most PER_ORG branches of one organization.
  const first = await links.claim(db, "x", 10);
  assert.equal(first.filter((row) => row.org === id).length, links.PER_ORG);
  await db.execute(
    sql`UPDATE api.index_link_branches SET claimed_by = NULL, claimed_until = NULL, dirty = true WHERE ${mine}`,
  );
  const [a, b] = await Promise.all([links.claim(db, "a", 2), links.claim(db, "b", 2)]);
  const claimed = [...a, ...b].map((row) => row.branch);
  assert.equal(new Set(claimed).size, claimed.length);
  // A server that died leaves its claim to run out; then another takes the branch.
  await db.execute(
    sql`UPDATE api.index_link_branches SET claimed_until = now() - interval '1 second', dirty = true WHERE ${mine} AND claimed_by = 'a'`,
  );
  const again = await links.claim(db, "c", 10);
  for (const row of a) assert.ok(again.some((taken) => taken.branch === row.branch));
  // A claim another server holds now can no longer be finished by the one that lost it.
  const lost = a[0]!;
  await links.synced(db, lost, "a", "x");
  assert.equal((await links.branch(db, id, "prod/app", lost.branch))!.claimedBy, "c");
});

test("a branch forked with its index starts from a stamp", { skip }, async () => {
  const s = await server();
  const { id, key } = await linked(s);
  await commit(s, key, [{ path: "fish.md", text: "salmon" }]);
  await s.services.syncer.drain();

  const forked = await s.call("POST", `${NS}/branches`, key, {
    name: "feature",
    from: "main",
    withIndex: true,
  });
  assert.equal(forked.status, 201, JSON.stringify(forked.body));
  const row = (await links.branch(s.services.db, id, "prod/app", "feature"))!;
  assert.equal(row.synced, forked.body.head);
  // Already searchable before any sync: the fork carries main's documents.
  assert.deepEqual(await found(s, key, "salmon", "feature"), ["fish.md"]);

  await commit(s, key, [{ path: "fish.md", text: "trout" }], "feature");
  await s.services.syncer.drain();
  assert.deepEqual(await found(s, key, "trout", "feature"), ["fish.md"]);
  assert.deepEqual(await found(s, key, "trout"), []);

  // Deleting the files branch deletes its index branch.
  assert.equal((await s.call("DELETE", `${NS}/branches/feature`, key)).status, 204);
  assert.equal(await links.branch(s.services.db, id, "prod/app", "feature"), null);
  const branches = await s.call("GET", "/indexes/prod%2Ffiles/branches", key);
  const names = branches.body.branches ?? branches.body.items ?? branches.body;
  assert.ok(!JSON.stringify(names).includes("feature"));

  // Without a link there is no index to fork.
  const other = `n-${unique()}`;
  assert.equal((await s.call("POST", "/namespaces", key, { name: other })).status, 201);
  const refused = await s.call("POST", `/namespaces/${other}/branches`, key, {
    name: "main",
    withIndex: true,
  });
  assert.equal(refused.status, 409);
});

test("a long path's document id is a hash", () => {
  assert.equal(docId("a/b.txt"), "a/b.txt");
  const long = docId(`${"d/".repeat(200)}f.txt`);
  assert.match(long, /^h:[0-9a-f]{64}$/);
});
