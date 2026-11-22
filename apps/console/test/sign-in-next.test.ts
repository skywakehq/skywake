import assert from "node:assert/strict";
import { test } from "node:test";

import { safeNext } from "../lib/zone.ts";

test("after signing in, only a path on this console is followed", () => {
  assert.equal(safeNext("/n/app?x=1"), "/n/app?x=1");
  assert.equal(safeNext(null), "/");
  for (const bad of [
    "javascript:alert(1)",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "",
    "/\t/evil.example",
    "/\n/evil.example",
  ]) {
    assert.equal(safeNext(bad), "/", bad);
  }
});
