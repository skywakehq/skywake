import assert from "node:assert/strict";
import { test } from "node:test";

import { asc, eq, sql } from "drizzle-orm";

import { type Sealed, verify } from "../src/audit/chain.ts";
import type { AuditEvent } from "../src/audit/event.ts";
import { AuditRecorder } from "../src/audit/recorder.ts";
import { prune } from "../src/audit/store.ts";
import { audit } from "../src/db/schema.ts";
import { server, skip } from "./helpers.ts";

const event = (action: string): AuditEvent => ({
  at: new Date(),
  org: "o",
  owner: null,
  actor: "k",
  actorKind: "key",
  action,
  outcome: "ok",
  status: 200,
  method: "GET",
  route: "/v1/x",
  resource: {},
  details: null,
  requestId: "r",
  clientRequestId: null,
  ip: null,
  userAgent: null,
  durationMs: 1,
  bytesIn: null,
  bytesOut: null,
});

test("recording never waits on the store, and a failed write is tried again", async () => {
  const written: Sealed[] = [];
  let down = true;
  let release!: () => void;
  const slow = new Promise<void>((resolve) => (release = resolve));
  const recorder = new AuditRecorder(
    async (events) => {
      await slow;
      if (down) throw new Error("database down");
      written.push(...events);
    },
    () => {},
  );

  const started = performance.now();
  for (let i = 0; i < 10_000; i++) recorder.record(event(`a${i}`));
  assert.ok(performance.now() - started < 200, "recording 10,000 events takes no store time");

  release();
  await recorder.flush();
  assert.equal(written.length, 0);
  down = false;
  await recorder.flush();
  assert.equal(written.length, 10_000);
  assert.ok(verify(written), "the events form one unbroken chain");
  assert.deepEqual(
    written.slice(0, 2).map((e) => e.action),
    ["a0", "a1"],
  );
});

test("events past the limit while the store is down are counted, and the count is logged", async () => {
  const written: Sealed[] = [];
  let down = true;
  const recorder = new AuditRecorder(
    async (events) => {
      if (down) throw new Error("database down");
      written.push(...events);
    },
    () => {},
  );
  for (let i = 0; i < 100_005; i++) recorder.record(event("a"));
  await recorder.flush();
  down = false;
  await recorder.flush();
  assert.equal(written.length, 100_001);
  const gap = written.find((e) => e.action === "auditEventsDropped");
  assert.deepEqual(gap?.details, { count: 5 });
  assert.ok(verify(written));
});

test("a changed or missing event breaks the chain", async () => {
  const written: Sealed[] = [];
  const recorder = new AuditRecorder(
    async (events) => void written.push(...events),
    () => {},
  );
  for (const action of ["a", "b", "c"]) recorder.record(event(action));
  await recorder.flush();
  assert.ok(verify(written));
  assert.equal(verify([written[0]!, written[2]!]), false);
  assert.equal(
    verify([written[0]!, { ...written[1]!, actor: "someone else" }, written[2]!]),
    false,
  );
});

test(
  "every call is recorded: reads, writes and refusals, with who and from where",
  { skip },
  async () => {
    const s = await server();
    const { id, key } = await s.ready();
    const reader = (await s.call("POST", "/keys", key, { name: "r", role: "read" })).body;

    assert.equal(
      (
        await s.call(
          "GET",
          "/namespaces/prod%2Fapp/branches/main/files/content?path=a.txt",
          reader.key,
          undefined,
          { "user-agent": "agent-7" },
        )
      ).status,
      200,
    );
    assert.equal((await s.call("POST", "/namespaces", reader.key, { name: "x" })).status, 403);

    const log = (await s.call("GET", "/audit?limit=3", key)).body;
    assert.deepEqual(
      log.events.map((e: any) => [e.action, e.outcome, e.actor]),
      [
        ["createNamespace", "denied", `key:${reader.id}`],
        ["readFile", "ok", `key:${reader.id}`],
        ["createKey", "ok", log.events[2].actor],
      ],
    );
    assert.equal(log.events[2].details.key, reader.id);
    const read = log.events[1];
    assert.equal(read.org, id);
    assert.equal(read.actorKind, "key");
    assert.equal(read.userAgent, "agent-7");
    assert.deepEqual(read.resource, { namespace: "prod/app", branch: "main" });
    assert.equal(read.method, "GET");
    assert.ok(read.durationMs >= 0 && read.requestId && read.hash);
    assert.equal(JSON.stringify(read).includes("hello"), false, "no file contents");

    const next = (await s.call("GET", `/audit?limit=3&after=${log.next}`, key)).body;
    assert.equal(Number(next.events[0].id) < Number(log.next), true);

    const denied = (await s.call("GET", "/audit?outcome=denied", key)).body.events;
    assert.deepEqual(
      denied.map((e: any) => e.action),
      ["createNamespace"],
    );

    const created = (await s.call("GET", "/audit?action=createOrg", key)).body.events;
    assert.equal(created[0]?.actorKind, "operator");
    assert.equal(created[0]?.actor, "admin");
  },
);

test("with reads sent to the log, only writes reach Postgres", { skip }, async () => {
  const s = await server({ auditReads: "log" });
  const { key } = await s.ready();
  const path = "/namespaces/prod%2Fapp/branches/main/files/content?path=a.txt";
  assert.equal((await s.call("GET", path, key)).status, 200);
  await s.services.audit.flush();
  const kept = (await s.call("GET", "/audit?limit=50", key)).body.events;
  assert.ok(!kept.some((e: any) => e.action === "readFile"), "the read is not in Postgres");
  assert.ok(kept.some((e: any) => e.action === "createKey" || e.action === "createNamespace"));
  const logged = s.logs.filter(
    (entry: any) => entry.msg === "audit" && entry.action === "readFile",
  );
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.outcome, "ok");
});

test("another organization's events and the audit log itself stay apart", { skip }, async () => {
  const s = await server();
  const one = await s.ready();
  const two = await s.org();
  await s.call("GET", "/namespaces", two.key);
  const seen = (await s.call("GET", "/audit?limit=1000", one.key)).body.events;
  assert.ok(seen.every((e: any) => e.org === one.id || e.owner === one.id));
  assert.equal((await s.call("GET", "/audit?since=not-a-time", one.key)).status, 400);
  const reads = (await s.call("GET", "/audit?action=auditLog", one.key)).body.events;
  assert.ok(reads.length >= 2);
});

test("owners of a public namespace see who else used it", { skip }, async () => {
  const s = await server();
  const one = await s.ready();
  const two = await s.org();
  const shared = { visibility: "public" };
  assert.equal((await s.call("PATCH", "/namespaces/prod%2Fapp", one.key, shared)).status, 204);
  const path = `/namespaces/${one.id}:prod%2Fapp/branches/main/files/content?path=a.txt`;
  assert.equal((await s.call("GET", path, two.key)).status, 200);
  assert.equal((await s.call("GET", path)).status, 200);

  const reads = (await s.call("GET", "/audit?action=readFile", one.key)).body.events;
  const theirs = reads.filter((e: any) => e.org !== one.id);
  assert.deepEqual(theirs.map((e: any) => [e.org, e.owner]).sort(), [
    [null, one.id],
    [two.id, one.id],
  ]);
  assert.ok(reads.filter((e: any) => e.org === one.id).every((e: any) => e.owner === null));
  const seen = (await s.call("GET", "/audit?limit=1000", two.key)).body.events;
  assert.ok(seen.every((e: any) => e.org === two.id));
});

test("old events are pruned", { skip }, async () => {
  const s = await server();
  const { key } = await s.org();
  await s.call("GET", "/namespaces", key);
  await s.services.audit.flush();
  await s.db.execute(
    sql`update api.audit set at = now() - interval '400 days' where action = 'listNamespaces'`,
  );
  assert.ok((await prune(s.db, 365)) >= 1);
  const left = (await s.call("GET", "/audit?action=listNamespaces", key)).body.events;
  assert.equal(left.length, 0);
});

test("events read back from the database still verify", { skip }, async () => {
  const s = await server();
  const { key } = await s.ready();
  await s.call("POST", "/keys", key, { name: "r", role: "read" });
  await s.call("GET", "/namespaces/prod%2Fapp/branches/main/files/content?path=a.txt", key);
  await s.services.audit.flush();
  const rows = await s.db
    .select()
    .from(audit)
    .where(eq(audit.chain, s.services.audit.chain))
    .orderBy(asc(audit.seq));
  assert.ok(rows.length >= 3);
  assert.ok(verify(rows.map(({ id: _, ...event }) => event)));
});
