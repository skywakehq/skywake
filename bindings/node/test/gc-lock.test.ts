// Write credentials could once write `gc/lock` (the API now denies it, see
// apps/api/src/features/credentials/mint.ts). A forged lock must still never
// make a writer wait forever or crash the engine.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { zstdCompressSync } from "node:zlib";

import { Engine } from "../index.js";

/** A u64 as postcard writes it. */
function varint(n: bigint) {
  const out: number[] = [];
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return Buffer.from(out);
}

/** Writes a lock held until `until` (seconds since 1970), then forks at the head. */
async function forkUnderLock(until: bigint, seconds: number) {
  const dir = mkdtempSync(join(tmpdir(), "skywake-gc-lock-"));
  const engine = Engine.open(dir);
  await engine.createBranch("main");
  const head = await engine.commitFiles("main", "one", [{ path: "a", content: Buffer.from("x") }]);
  mkdirSync(join(dir, "gc"), { recursive: true });
  // Format version 1, then the zstd-compressed record.
  writeFileSync(
    join(dir, "gc", "lock"),
    Buffer.concat([Buffer.from([1]), zstdCompressSync(varint(until))]),
  );
  let timer: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    engine.forkAt("restore", head).then(
      () => "done",
      (error: Error) => `error: ${error.message}`,
    ),
    new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve("still waiting"), seconds * 1000);
    }),
  ]);
  clearTimeout(timer);
  return result;
}

test("a lock far in the future makes a fork fail fast instead of hanging", async () => {
  const tenYears = BigInt(Math.floor(Date.now() / 1000) + 10 * 365 * 86400);
  assert.notEqual(await forkUnderLock(tenYears, 20), "still waiting");
});

test("a lock with an overflowing time does not crash the engine", async () => {
  const result = await forkUnderLock(2n ** 64n - 1n, 10);
  assert.notEqual(result, "still waiting");
  assert.doesNotMatch(result, /panic|overflow/i);
});
