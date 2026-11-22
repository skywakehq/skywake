import assert from "node:assert/strict";
import { test } from "node:test";

import { Places } from "../src/mcp/places.ts";

const sky = { disk: (name, { branch }) => ({ name, branch }) };

test("a fork moves the work even when SKYWAKE_BRANCH names a branch", async () => {
  const places = new Places(sky, "app", "main");
  assert.equal((await places.writing()).branch, "main");
  places.use(undefined, "agent-1");
  assert.equal((await places.writing()).branch, "agent-1");
  assert.equal((await places.reading()).branch, "agent-1");
  assert.equal((await places.writing("other")).branch, "main");
});
