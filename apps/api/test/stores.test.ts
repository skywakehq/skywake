import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Stores } from "../src/engine/stores.ts";

test("open indexes are bounded, and the least recently used is closed first", () => {
  const stores = new Stores([["local", mkdtempSync(join(tmpdir(), "skywake-stores-"))]], 2);
  const a = stores.index("local", "a");
  const b = stores.index("local", "b");
  assert.equal(stores.index("local", "a"), a, "kept while open");
  stores.index("local", "c");
  assert.equal(stores.index("local", "a"), a, "a was used last, so b was closed");
  assert.notEqual(stores.index("local", "b"), b, "b is opened again");
});
