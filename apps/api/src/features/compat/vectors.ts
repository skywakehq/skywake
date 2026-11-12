import { invalidAt } from "../../http/errors.ts";

export function decodeVector(value: unknown, path: string): number[] {
  if (Array.isArray(value)) return value as number[];
  if (typeof value !== "string") throw invalidAt(path, "a vector is a list of numbers or base64");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length % 4 !== 0) {
    throw invalidAt(path, "base64 vectors hold little-endian f32s");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 4 }, (_, i) => view.getFloat32(i * 4, true));
}

export function encodeVector(numbers: number[]): string {
  const bytes = Buffer.alloc(numbers.length * 4);
  numbers.forEach((n, i) => bytes.writeFloatLE(n, i * 4));
  return bytes.toString("base64");
}
