import assert from "node:assert/strict";
import { test } from "node:test";

import { parse } from "../lib/routes.ts";

test("a disk is its environment and short name", () => {
  assert.deepEqual(parse("/e/prod/d/app"), { view: "files", ns: "prod/app" });
  assert.deepEqual(parse("/e/default/d/app/search"), { view: "search", ns: "app" });
  assert.deepEqual(parse("/e/prod/d/app/nope"), { view: "missing" });
});

test("a branch is NAME@BRANCH, and may hold slashes", () => {
  assert.deepEqual(parse("/e/prod/d/app@main"), { view: "branch", ns: "prod/app", branch: "main" });
  assert.deepEqual(parse("/e/prod/d/app@agents/1"), {
    view: "branch",
    ns: "prod/app",
    branch: "agents/1",
  });
  assert.deepEqual(parse("/e/prod/d/app@"), { view: "missing" });
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
});

test("old addresses still open", () => {
  assert.deepEqual(parse("/n/prod%2Fapp/b/agents/1"), {
    view: "branch",
    ns: "prod/app",
    branch: "agents/1",
  });
  assert.deepEqual(parse("/n/prod%2Fapp/history"), { view: "history", ns: "prod/app" });
  assert.deepEqual(parse("/i/prod%2Fproducts/query"), {
    view: "index",
    index: "prod/products",
    tab: "query",
  });
});

test("the sign-in page for the CLI takes its code", () => {
  assert.deepEqual(parse("/cli/ABCD-2345"), { view: "cli", code: "ABCD-2345" });
});
