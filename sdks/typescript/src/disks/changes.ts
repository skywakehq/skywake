import type { Schemas } from "../core/api.js";
import { asText, toBase64, utf8 } from "../core/bytes.js";

export type FileChange = Schemas["FileChange"];
export type Content = string | Uint8Array | ArrayBuffer | Blob;
export type Upload = (bytes: Uint8Array) => Promise<string>;

export const COMMIT = { count: 10_000, bytes: 32 * 1024 * 1024 };
export const INLINE_MAX = 4 * 1024 * 1024;
export const PART_MAX = 16 * 1024 * 1024;

export function weight(path: string, size: number): number {
  const content = size > INLINE_MAX ? Math.ceil(size / PART_MAX) * 70 : Math.ceil(size / 3) * 4;
  return path.length * 6 + 64 + content;
}

export async function bytesOf(content: Exclude<Content, string>): Promise<Uint8Array> {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new Uint8Array(await content.arrayBuffer());
}

export async function uploadParts(bytes: Uint8Array, upload: Upload): Promise<string[]> {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += PART_MAX) {
    parts.push(await upload(bytes.subarray(offset, offset + PART_MAX)));
  }
  return parts;
}

export async function changeOf(
  path: string,
  content: Content,
  upload: Upload,
  executable?: boolean,
): Promise<FileChange> {
  const flags = executable === undefined ? {} : { executable };
  if (typeof content === "string" && content.length * 3 <= INLINE_MAX) {
    return { path, text: content, ...flags };
  }
  const bytes = typeof content === "string" ? utf8(content) : await bytesOf(content);
  if (bytes.length > INLINE_MAX) return { path, parts: await uploadParts(bytes, upload), ...flags };
  const text = asText(bytes);
  return text === undefined
    ? { path, base64: toBase64(bytes), ...flags }
    : { path, text, ...flags };
}
