import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Stores } from "../src/engine/stores.ts";

test("open engines are bounded, and the least recently used is closed first", () => {
  const stores = new Stores([["local", mkdtempSync(join(tmpdir(), "skywake-stores-"))]], 2);
  const a = stores.engine("local", "a");
  const b = stores.engine("local", "b");
  assert.equal(stores.engine("local", "a"), a, "kept while open");
  stores.engine("local", "c");
  assert.equal(stores.engine("local", "a"), a, "a was used last, so b was closed");
  assert.notEqual(stores.engine("local", "b"), b, "b is opened again");
});
