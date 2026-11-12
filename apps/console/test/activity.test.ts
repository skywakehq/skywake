import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { changesOf } from "../features/fleet/events.ts";
import { queries } from "../zero/queries.ts";
import { seesAudit } from "../zero/roles.ts";
import type { Branch, Commit } from "../zero/schema.ts";

const { mustGetQuery } = await import(createRequire(import.meta.url).resolve("@rocicorp/zero"));

function activityFor(role: string) {
  const query = mustGetQuery(queries, "activity").fn({
    args: { limit: 10 },
    ctx: { userID: "u1", org: "o1", role },
  });
  return JSON.stringify(query.ast);
}

test("only owners and admins read the audit log, as on the API", () => {
  assert.deepEqual(["owner", "admin", "admin,member", "member", ""].map(seesAudit), [
    true,
    true,
    true,
    false,
    false,
  ]);
  const none = /"op":"<".*"name":"id".*"value":0/;
  assert.doesNotMatch(activityFor("admin"), none);
  assert.match(activityFor("member"), none);
});

test("members see commits, merges, forks and new filesystems", () => {
  const commit = (
    hash: string,
    branch: string,
    at: number,
    merged: string | null = null,
  ): Commit => ({
    org: "o1",
    namespace: "app",
    branch,
    hash,
    parent: null,
    message: "",
    session: null,
    merged,
    actor: "user:a",
    changes: [],
    at,
    agent: null,
  });
  const commits = [commit("c1", "try", 2), commit("c2", "main", 3, "c1")];
  const branches = [
    {
      org: "o1",
      namespace: "app",
      name: "try",
      forkedFrom: "main",
      protected: false,
      created: 1,
      updated: 2,
    },
  ] as Branch[];
  const events = changesOf(commits, branches, [{ name: "app", created: 0 }]);
  assert.deepEqual(
    events.map((e) => [e.kind, e.branch, e.from ?? ""]),
    [
      ["merge", "main", "try"],
      ["commit", "try", ""],
      ["fork", "try", ""],
      ["create", "", ""],
    ],
  );
  assert.ok(events.every((e) => e.id < 0));
});
