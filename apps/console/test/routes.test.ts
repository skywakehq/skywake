import assert from "node:assert/strict";
import { test } from "node:test";

import { parse } from "../lib/routes.ts";

test("an environment opens on its indexes", () => {
  assert.deepEqual(parse("/e/prod"), { view: "indexes", env: "prod" });
  assert.deepEqual(parse("/e/prod/indexes"), { view: "indexes", env: "prod" });
  assert.deepEqual(parse("/e/prod/nope"), { view: "missing" });
});

test("an index has tabs, and the old documents tab is rows", () => {
  assert.deepEqual(parse("/e/prod/i/products"), {
    view: "index",
    index: "prod/products",
    tab: "overview",
  });
  assert.deepEqual(parse("/e/prod/i/products/documents"), {
    view: "index",
    index: "prod/products",
    tab: "rows",
  });
  assert.deepEqual(parse("/e/prod/i/products/nope"), { view: "missing" });
});

test("old index addresses still open", () => {
  assert.deepEqual(parse("/i/prod%2Fproducts/query"), {
    view: "index",
    index: "prod/products",
    tab: "query",
  });
});

test("disk addresses are gone", () => {
  assert.deepEqual(parse("/e/prod/d/app"), { view: "missing" });
  assert.deepEqual(parse("/n/prod%2Fapp/history"), { view: "missing" });
  assert.deepEqual(parse("/e/prod/activity"), { view: "missing" });
  assert.deepEqual(parse("/usage"), { view: "missing" });
});

test("the sign-in page for the CLI takes its code", () => {
  assert.deepEqual(parse("/cli/ABCD-2345"), { view: "cli", code: "ABCD-2345" });
});
