#!/usr/bin/env node
// Runs the prebuilt skywake binary npm installed for this machine.
"use strict";

const { spawnSync } = require("node:child_process");

const PACKAGES = {
  "linux x64": "@skywake/cli-linux-x64",
  "linux arm64": "@skywake/cli-linux-arm64",
};

function binary() {
  if (process.env.SKYWAKE_BINARY) return process.env.SKYWAKE_BINARY;
  if (musl()) {
    fail(
      "skywake has no build for musl Linux (such as Alpine) yet. Use a glibc-based system " +
        "(such as Debian or Ubuntu), or build the skywake-cli crate from source with cargo.",
    );
  }
  const name = PACKAGES[`${process.platform} ${process.arch}`];
  if (!name) {
    fail(
      `skywake has no prebuilt binary for ${process.platform} on ${process.arch} yet. ` +
        "Build the skywake-cli crate from source with cargo instead.",
    );
  }
  try {
    return require.resolve(`${name}/bin/skywake`);
  } catch {
    fail(
      `${name} is not installed. It is an optional dependency of skywake, so it is skipped ` +
        "when optional dependencies are turned off (--no-optional, --omit=optional). Install again with them.",
    );
  }
}

// Node built against glibc reports the glibc version it runs on; on musl it reports none.
function musl() {
  return process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime;
}

function fail(message) {
  process.stderr.write(`skywake: ${message}\n`);
  process.exit(1);
}

const result = spawnSync(binary(), process.argv.slice(2), { stdio: "inherit" });
if (result.error) fail(result.error.message);
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
