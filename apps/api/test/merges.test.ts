import assert from "node:assert/strict";
import { test } from "node:test";

import type { Engine } from "@skywake/engine";

import { connect } from "../src/db/client.ts";
import { withLease } from "../src/db/leases.ts";
import { DATABASE, server, skip, unique } from "./helpers.ts";

const NS = "/namespaces/prod%2Fapp";

/** Makes the engine's merges wait at a gate, and tells when one reaches it. */
function gateMerges(s: Awaited<ReturnType<typeof server>>) {
  const reached: (() => void)[] = [];
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const waiters: Promise<void>[] = [];
  const nextReached = () => {
    waiters.push(new Promise<void>((resolve) => reached.push(resolve)));
  };
  nextReached();
  let merges = 0;
  const stores = s.services.stores;
  const engineOf = stores.engine.bind(stores);
  stores.engine = (region, folder) => {
    const engine = engineOf(region, folder);
    return new Proxy(engine, {
      get(target, name) {
        if (name === "merge") {
          return async (...args: Parameters<Engine["merge"]>) => {
            merges++;
            reached.shift()?.();
            await gate;
            return target.merge(...args);
          };
        }
        const value = Reflect.get(target, name);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return { reached: waiters[0]!, open, merges: () => merges };
}

async function prepare(s: Awaited<ReturnType<typeof server>>) {
  const { key } = await s.ready();
  for (const name of ["one", "two"]) {
    await s.call("POST", `${NS}/branches`, key, { name, from: "main" });
    const commit = { message: name, changes: [{ path: `${name}.txt`, text: name }] };
    assert.equal((await s.call("POST", `${NS}/branches/${name}/commits`, key, commit)).status, 201);
  }
  return key;
}

test("a merge holds no database connection while the store works", { skip }, async (t) => {
  // One connection only: if the merge held it, nothing else could run.
  const { db, pool } = connect(DATABASE!, 1);
  t.after(() => pool.end());
  const s = await server({}, { db });
  const key = await prepare(s);
  const gate = gateMerges(s);

  const merging = s.call("POST", `${NS}/merges`, key, { from: "one", into: "main" });
  await gate.reached;
  const listed = await Promise.race([
    s.call("GET", `${NS}/branches`, key),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000).unref()),
  ]);
  gate.open();
  assert.equal((await merging).status, 200);
  assert.ok(listed, "the database waited for the merge");
  assert.equal(listed.status, 200);
});

test("merges into one branch wait for each other across processes", { skip }, async () => {
  const one = await server();
  const key = await prepare(one);
  // A second process: its own engines and its own in-process queue.
  const two = await server({ regions: one.services.config.regions });
  const first = gateMerges(one);
  const second = gateMerges(two);

  const merging = one.call("POST", `${NS}/merges`, key, { from: "one", into: "main" });
  await first.reached;
  const waiting = two.call("POST", `${NS}/merges`, key, { from: "two", into: "main" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(second.merges(), 0, "the second merge started while the first held the lease");
  first.open();
  assert.equal((await merging).status, 200);
  await second.reached;
  second.open();
  assert.equal((await waiting).status, 200);
});

test("a lease that cannot be let go is logged, and the work's answer kept", { skip }, async () => {
  const s = await server();
  const logs: { level: string; msg: string }[] = [];
  const failing = new Proxy(s.db, {
    get(target, name) {
      if (name === "delete") {
        return () => ({ where: () => Promise.reject(new Error("connection lost")) });
      }
      const value = Reflect.get(target, name);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const done = await withLease(failing, `test/${unique()}`, async () => "done", {
    log: (entry) => logs.push(entry),
  });
  assert.equal(done, "done");
  assert.equal(logs[0]?.level, "warn");
});
