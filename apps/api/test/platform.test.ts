import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { document } from "@skywake/contract";
import { EngineError } from "@skywake/engine";
import { sql } from "drizzle-orm";

import * as namespaces from "../src/features/namespaces/queries.ts";
import { ADMIN, server, skip, token, unique } from "./helpers.ts";

test("heads and commits are recorded for the console", { skip }, async () => {
  const s = await server();
  const org = `org_${unique()}`;
  const created = await s.call("POST", "/orgs", ADMIN, { name: `o-${unique()}`, id: org });
  assert.deepEqual(created.body, { id: org, key: null });

  const key = await token(org, "owner");
  await s.call("POST", "/namespaces", key, { name: "prod/app" });
  await s.call("POST", "/namespaces/prod%2Fapp/branches", key, { name: "main" });
  const commit = { message: "write", changes: [{ path: "a.txt", text: "hi" }] };
  const written = await s.call("POST", "/namespaces/prod%2Fapp/branches/main/commits", key, commit);

  const head = await s.db.execute(
    sql`SELECT head FROM api.branches WHERE org = ${org} AND name = 'main'`,
  );
  assert.equal(head.rows[0]!.head, written.body.head);
  const row = await s.db.execute(
    sql`SELECT message, actor, changes FROM api.commits WHERE org = ${org}`,
  );
  assert.deepEqual(row.rows[0], {
    message: "write",
    actor: "user:user-1",
    changes: [{ kind: "added", path: "a.txt" }],
  });
});

test("an environment has no region; each namespace and index picks its own", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  assert.deepEqual((await s.call("GET", "/regions", key)).body, [
    { name: "local", default: true },
    { name: "eu", default: false },
  ]);
  const env = await s.call("POST", "/environments", key, { name: "prod" });
  assert.equal(env.status, 201);
  assert.equal(env.body.region, undefined);
  assert.equal((await s.call("POST", "/environments", key, { name: "prod" })).status, 409);

  const eu = await s.call("POST", "/namespaces", key, { name: "prod/app", region: "eu" });
  assert.equal(eu.body.region, "eu");
  const local = await s.call("POST", "/namespaces", key, { name: "prod/web" });
  assert.equal(local.body.region, "local", "the default region when none is asked for");
  assert.equal(
    (await s.call("POST", "/namespaces", key, { name: "prod/x", region: "mars" })).status,
    400,
  );

  const index = await s.call("POST", "/indexes", key, {
    name: "prod/docs",
    region: "eu",
    schema: { vectors: [{ name: "v", dims: 2 }] },
  });
  assert.equal(index.body.region, "eu");
  const copy = await s.call("POST", "/indexes/prod%2Fdocs/copy", key, { name: "prod/docs-copy" });
  assert.equal(copy.body.region, "eu", "a copy stays in its source's region");

  await s.call("POST", "/namespaces/prod%2Fapp/branches", key, { name: "main" });
  assert.ok(existsSync(join(s.store, "eu")));
});

test("the server describes itself with the contract's document", { skip }, async () => {
  const s = await server();
  const served = await s.call("GET", "/openapi.json");
  assert.equal(served.status, 200);
  assert.deepEqual(served.body, JSON.parse(JSON.stringify(document())));
});

function loseAnswers(s: Awaited<ReturnType<typeof server>>, method: "createBranch" | "forkAt") {
  const stores = s.services.stores;
  const open = stores.engine.bind(stores);
  stores.engine = (region, folder) => {
    const engine = open(region, folder);
    return new Proxy(engine, {
      get(target, name) {
        if (name === method) {
          return async (...args: [string, string]) => {
            await target[method](...args).catch(() => {});
            const Failure = EngineError as unknown as new (kind: string, message: string) => Error;
            throw new Failure("unavailable", "the write may or may not have landed");
          };
        }
        const value = Reflect.get(target, name);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return () => (stores.engine = open);
}

test("a branch made in the store is never left without its row", { skip }, async () => {
  const s = await server();
  const { key } = await s.ready();
  const ns = "/namespaces/prod%2Fapp/branches";
  const names = async () =>
    (await s.call("GET", ns, key)).body.map((branch: { name: string }) => branch.name);

  const restore = loseAnswers(s, "createBranch");
  const made = await s.call("POST", ns, key, { name: "fix", from: "main" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.ok((await names()).includes("fix"));
  assert.equal((await s.call("POST", ns, key, { name: "blank" })).status, 201);
  assert.ok((await names()).includes("blank"));
  restore();

  const main = (await s.call("GET", `${ns}/main`, key)).body.head;
  loseAnswers(s, "forkAt");
  const forked = await s.call("POST", ns, key, { name: "old", at: main });
  assert.equal(forked.status, 201, JSON.stringify(forked.body));
  assert.equal(forked.body.head, main);
  assert.ok((await names()).includes("old"));

  assert.equal((await s.call("POST", ns, key, { name: "lost", from: "nope" })).status, 404);
  assert.ok(!(await names()).includes("lost"));
});

test("a branch planted in the store is never taken over", { skip }, async () => {
  const s = await server();
  const { id, key } = await s.ready();
  const ns = "/namespaces/prod%2Fapp/branches";
  const row = (await namespaces.find(s.db, id, "prod/app"))!;
  const engine = s.services.stores.engine(row.region, row.folder);
  const main = await engine.head("main");
  const plant = async (name: string) => {
    await engine.createBranch(name, "main");
    await engine.commitFiles(name, "evil", [{ path: "a.txt", content: Buffer.from("evil") }]);
  };
  const names = async () =>
    (await s.call("GET", ns, key)).body.map((branch: { name: string }) => branch.name);

  await plant("release");
  assert.equal((await s.call("POST", ns, key, { name: "release", from: "main" })).status, 409);
  await plant("r2");
  assert.equal((await s.call("POST", ns, key, { name: "r2", at: main })).status, 409);

  await plant("r3");
  loseAnswers(s, "createBranch");
  assert.equal((await s.call("POST", ns, key, { name: "r3", from: "main" })).status, 409);
  assert.deepEqual(await names(), ["main"]);
});

test("lists anyone may read come in pages", { skip }, async () => {
  const s = await server();
  const { key } = await s.ready();
  const ns = "/namespaces/prod%2Fapp";
  const main = `${ns}/branches/main`;
  for (const name of ["b1", "b2", "b3"]) {
    await s.call("POST", `${ns}/branches`, key, { name, from: "main" });
  }
  for (const text of ["2", "3"]) {
    await s.call("POST", `${main}/commits`, key, {
      message: text,
      changes: [
        { path: "a.txt", text },
        { path: `f${text}.txt`, text },
      ],
    });
  }
  const sessions = [];
  for (const label of ["s1", "s2", "s3"]) {
    const session = (await s.call("POST", `${ns}/sessions`, key, { label })).body;
    sessions.push(session.id);
    await s.call("POST", `${main}/claims`, key, { path: label, session: session.id });
  }
  const get = async (path: string) => {
    const answer = await s.call("GET", path, key);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    return answer.body;
  };
  const names = (items: { name: string }[]) => items.map((item) => item.name);

  assert.deepEqual(names(await get(`${ns}/branches?limit=2`)), ["b1", "b2"]);
  assert.deepEqual(names(await get(`${ns}/branches?limit=2&after=b2`)), ["b3", "main"]);

  const files = await get(`${main}/files?limit=2`);
  assert.deepEqual(names(files.entries), ["a.txt", "f2.txt"]);
  assert.deepEqual(names((await get(`${main}/files?limit=2&after=f2.txt`)).entries), ["f3.txt"]);

  const versions = await get(`${main}/files/history?path=a.txt&limit=2`);
  assert.equal(versions.length, 2);
  const older = await get(`${main}/files/history?path=a.txt&limit=2&after=${versions[1].hash}`);
  assert.deepEqual(
    older.map((version: { message: string }) => version.message),
    ["add"],
  );

  const paths = (items: { path: string }[]) => items.map((item) => item.path);
  assert.deepEqual(paths(await get(`${main}/diff?from=b1&limit=1`)), ["a.txt"]);
  assert.deepEqual(paths(await get(`${main}/diff?from=b1&after=a.txt`)), ["f2.txt", "f3.txt"]);

  const ids = (items: { id: string }[]) => items.map((item) => item.id);
  assert.deepEqual(ids(await get(`${ns}/sessions?limit=2`)), sessions.slice(0, 2));
  assert.deepEqual(ids(await get(`${ns}/sessions?after=${sessions[1]}`)), sessions.slice(2));
  assert.deepEqual(paths(await get(`${main}/claims?limit=2`)), ["s1", "s2"]);
  assert.deepEqual(paths(await get(`${main}/claims?after=s2`)), ["s3"]);
});

test("a lost create from a source that moved is kept", { skip }, async () => {
  const s = await server();
  const { key } = await s.ready();
  const path = "/namespaces/prod%2Fapp/branches";
  const stores = s.services.stores;
  const open = stores.engine.bind(stores);
  stores.engine = (region, folder) => {
    const engine = open(region, folder);
    return new Proxy(engine, {
      get(target, name) {
        if (name === "forkAt" || name === "createBranch") {
          return async (branch: string, from: string) => {
            await target.commitFiles("main", "moved", [
              { path: "m.txt", content: Buffer.from("x") },
            ]);
            await (name === "forkAt"
              ? target.forkAt(branch, from)
              : target.createBranch(branch, from));
            const Failure = EngineError as unknown as new (kind: string, message: string) => Error;
            throw new Failure("unavailable", "answer lost");
          };
        }
        const value = Reflect.get(target, name);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  const made = await s.call("POST", path, key, { name: "fix", from: "main" });
  stores.engine = open;
  assert.equal(made.status, 201);
  const names = (await s.call("GET", path, key)).body.map((b: { name: string }) => b.name);
  assert.ok(names.includes("fix"));
});
