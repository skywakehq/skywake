import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const wrapper = fileURLToPath(new URL("../bin/skywake.js", import.meta.url));

test("the wrapper runs the binary with the same arguments and exit code", () => {
  const dir = mkdtempSync(join(tmpdir(), "skywake-cli-"));
  const fake = join(dir, "skywake");
  writeFileSync(fake, '#!/bin/sh\necho "args: $*"\nexit 3\n');
  chmodSync(fake, 0o755);
  const run = spawnSync(process.execPath, [wrapper, "new", "agent-1", "--from", "main"], {
    env: { ...process.env, SKYWAKE_BINARY: fake },
    encoding: "utf8",
  });
  assert.equal(run.stdout, "args: new agent-1 --from main\n");
  assert.equal(run.status, 3);
});

test("without a binary for this machine, the wrapper says what to do", () => {
  const env = { ...process.env };
  delete env.SKYWAKE_BINARY;
  const run = spawnSync(process.execPath, [wrapper, "--help"], { env, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^skywake: /);
});

test("on musl Linux, such as Alpine, the wrapper says there is no build for it yet", () => {
  // Pretend to be x64 Linux whose Node was built against musl, not glibc.
  const dir = mkdtempSync(join(tmpdir(), "skywake-cli-"));
  const musl = join(dir, "musl.cjs");
  writeFileSync(
    musl,
    'Object.defineProperty(process, "platform", { value: "linux" });\n' +
      'Object.defineProperty(process, "arch", { value: "x64" });\n' +
      "process.report.getReport = () => ({ header: {} });\n",
  );
  const env = { ...process.env };
  delete env.SKYWAKE_BINARY;
  const run = spawnSync(process.execPath, ["--require", musl, wrapper, "--help"], {
    env,
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /no build for musl Linux/);
});
