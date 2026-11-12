import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { apiEnv, consoleEnv, loadEnv, readEnv } from "../src/index.ts";

test("loadEnv reads the root .env from a nested folder, and set values win", () => {
  const root = mkdtempSync(join(tmpdir(), "skywake-env-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "");
  writeFileSync(join(root, ".env"), "SKYWAKE_TEST_A=from-file\nSKYWAKE_TEST_B=from-file\n");
  mkdirSync(join(root, "apps", "api"), { recursive: true });
  process.env.SKYWAKE_TEST_B = "from-shell";

  loadEnv(join(root, "apps", "api"));

  assert.equal(process.env.SKYWAKE_TEST_A, "from-file");
  assert.equal(process.env.SKYWAKE_TEST_B, "from-shell");
});

test("loadEnv does nothing without a .env", () => {
  const root = mkdtempSync(join(tmpdir(), "skywake-env-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "");
  assert.doesNotThrow(() => loadEnv(root));
});

test("readEnv treats empty values as unset and reports every problem", () => {
  assert.throws(
    () => readEnv(consoleEnv, { DATABASE_URL: "", BETTER_AUTH_SECRET: "short" }),
    (error: Error) =>
      error.message.includes("DATABASE_URL: needed") &&
      error.message.includes("BETTER_AUTH_SECRET: at least 32 characters") &&
      error.message.includes("SKYWAKE_API_URL: needed"),
  );
});

test("readEnv fills the API's defaults", () => {
  const env = readEnv(apiEnv, {
    SKYWAKE_API_DATABASE: "postgres://localhost/skywake",
    SKYWAKE_STORE: "s3://skywake",
    SKYWAKE_API_REGIONS: "",
  });
  assert.equal(env.SKYWAKE_API_LISTEN, "0.0.0.0:8080");
  assert.equal(env.SKYWAKE_API_REGIONS, "");
});

const base = {
  DATABASE_URL: "postgres://localhost/skywake",
  BETTER_AUTH_URL: "http://localhost:3100",
  BETTER_AUTH_SECRET: "x".repeat(32),
  SKYWAKE_API_URL: "http://localhost:8080/v1",
  SKYWAKE_API_ADMIN_TOKEN: "y".repeat(16),
  PUBLIC_ZERO_URL: "http://localhost:4848",
  PUBLIC_API_URL: "http://localhost:8080",
};

test("the console needs none of the hosted service's settings", () => {
  const env = readEnv(consoleEnv, { ...base, RESEND_API_KEY: "", GOOGLE_CLIENT_ID: "" });
  assert.equal(env.RESEND_API_KEY, undefined);
  assert.equal(env.GOOGLE_CLIENT_ID, undefined);
});

test("email needs a sender, and a provider needs both its id and secret", () => {
  assert.throws(
    () =>
      readEnv(consoleEnv, { ...base, SMTP_URL: "smtp://localhost:1025", GITHUB_CLIENT_ID: "id" }),
    (error: Error) =>
      error.message.includes("EMAIL_FROM: needed") &&
      error.message.includes("GITHUB_CLIENT_SECRET: needed"),
  );
});
