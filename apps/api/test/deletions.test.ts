import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sql } from "drizzle-orm";

import { Deleter } from "../src/features/deletions/worker.ts";
import { holdsData } from "../src/features/environments/queries.ts";
import { server, skip } from "./helpers.ts";

const files = (dir: string) =>
  existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()) : [];

async function pending(s: Awaited<ReturnType<typeof server>>, org: string) {
  const rows = await s.services.db.execute<{ kind: string; folder: string; attempts: number }>(
    sql`SELECT kind, folder, attempts FROM api.deletions WHERE org = ${org}`,
  );
  return rows.rows;
}

test("a deleted namespace's files leave the bucket", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.ready();
  const ns = (await s.services.db.query.namespaces.findFirst({
    where: (t, { and, eq }) => and(eq(t.org, id), eq(t.name, "prod/app")),
  }))!;
  const folder = join(s.store, ns.region, ns.folder);
  assert.ok(files(folder).length > 0);

  assert.equal((await s.call("DELETE", "/namespaces/prod%2Fapp", key)).status, 204);
  assert.equal((await s.call("GET", "/namespaces/prod%2Fapp", key)).status, 404);
  assert.equal((await s.call("DELETE", "/namespaces/prod%2Fapp", key)).status, 404);
  assert.deepEqual(
    (await pending(s, id)).map((row) => row.kind),
    ["namespace"],
  );

  await s.services.deleter.drain();
  assert.equal(files(folder).length, 0);
  assert.deepEqual(await pending(s, id), []);
});

test("a deletion that fails is kept and tried again, by any server", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.ready();
  const made = await s.call("POST", "/indexes", key, {
    name: "prod/docs",
    schema: { vectors: [{ name: "v", dims: 2 }], attributes: [] },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const write = await s.call("POST", "/indexes/prod%2Fdocs/branches/main/documents", key, {
    documents: [{ id: 1, vectors: { v: [1, 0] } }],
  });
  assert.equal(write.status, 200, JSON.stringify(write.body));
  const ix = (await s.services.db.query.indexes.findFirst({
    where: (t, { and, eq }) => and(eq(t.org, id), eq(t.name, "prod/docs")),
  }))!;
  const folder = join(s.store, ix.region, ix.folder);
  assert.ok(files(folder).length > 0);

  // A region this server can't reach: the try fails, and the deletion stays.
  const db = s.services.db;
  await db.execute(sql`
    WITH gone AS (DELETE FROM api.indexes WHERE org = ${id} AND name = 'prod/docs'
      RETURNING org, name, folder)
    INSERT INTO api.deletions (org, kind, name, region, folder)
    SELECT org, 'index', name, 'nowhere', folder FROM gone`);
  await s.services.deleter.drain();
  const [failed] = await pending(s, id);
  assert.equal(failed?.attempts, 1);
  assert.ok(files(folder).length > 0);

  // Another server, as after a restart, finishes it once it is due.
  await db.execute(
    sql`UPDATE api.deletions SET region = ${ix.region}, due = now() WHERE org = ${id}`,
  );
  const other = new Deleter("other-server", db, s.services.stores, () => {});
  await other.drain();
  assert.equal(files(folder).length, 0);
  assert.deepEqual(await pending(s, id), []);
});

test("a deleted index's data leaves the bucket at once", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.org();
  assert.equal(
    (
      await s.call("POST", "/indexes", key, {
        name: "docs",
        schema: { vectors: [{ name: "v", dims: 2 }], attributes: [] },
      })
    ).status,
    201,
  );
  const ix = (await s.services.db.query.indexes.findFirst({
    where: (t, { and, eq }) => and(eq(t.org, id), eq(t.name, "docs")),
  }))!;
  const folder = join(s.store, ix.region, ix.folder);
  assert.equal((await s.call("DELETE", "/indexes/docs", key)).status, 204);
  await s.services.deleter.drain();
  assert.equal(files(folder).length, 0);
  assert.deepEqual(await pending(s, id), []);
});

test("an environment with folders still being deleted keeps its bucket", { skip }, async () => {
  const s = await server();
  const { id } = await s.org();
  const db = s.services.db;
  assert.equal(await holdsData(db, id, "prod"), false);
  await db.execute(sql`
    INSERT INTO api.deletions (org, kind, name, region, folder)
    VALUES (${id}, 'index', 'prod/x', ${`bucket:${id}/prod`}, 'ix/ix_gone')`);
  assert.equal(await holdsData(db, id, "prod"), true);
  await db.execute(sql`DELETE FROM api.deletions WHERE org = ${id}`);
});
