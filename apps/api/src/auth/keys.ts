import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { crc32 } from "node:zlib";

import { blake3 } from "@skywake/engine";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export const randomId = (prefix: string) => `${prefix}${hex(8)}`;

export const hashKey = (key: string) => blake3(Buffer.from(key));

export const KEY_PREFIX = "sw_";

// A key is `sw_<id>_<secret><checksum>`: the prefix and the CRC-32 at the end
// let secret scanners find leaked keys without false alarms.
const KEY = /^sw_([0-9a-f]{16})_[0-9a-f]{64}([0-9a-f]{8})$/;

const checksum = (text: string) => crc32(text).toString(16).padStart(8, "0");

export function newKey() {
  const id = hex(8);
  const body = `${KEY_PREFIX}${id}_${hex(32)}`;
  const key = body + checksum(body);
  return { id, key, hash: hashKey(key) };
}

/** The id of a well-formed key, or null. */
export function keyId(token: string): string | null {
  const match = KEY.exec(token);
  if (!match || checksum(token.slice(0, -8)) !== match[2]) return null;
  return match[1]!;
}

export function sameKey(token: string, stored: Uint8Array) {
  const hash = hashKey(token);
  return hash.length === stored.length && timingSafeEqual(hash, stored);
}

export class AdminToken {
  readonly #digest: Buffer | null;

  constructor(token?: string) {
    this.#digest = token ? sha256(token) : null;
  }

  matches(token: string | null) {
    return this.#digest !== null && token !== null && timingSafeEqual(sha256(token), this.#digest);
  }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest();
