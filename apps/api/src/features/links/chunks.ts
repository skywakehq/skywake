import { blake3 } from "@skywake/engine";

export const CHUNK_CHARS = 2_000;
export const OVERLAP_CHARS = 200;
export const CHUNKS_MAX = 512;
const ID_MAX = 256;
const BREAKS = ["\n\n", "\n", ". ", " "];
const JUNK_SHARE = 0.8;
const JUNK_MIN = 200;

export function docId(path: string) {
  if (path.length <= ID_MAX) return path;
  return `h:${hex(path)}`;
}

export function chunkId(path: string, chunk: number) {
  return chunk === 0 ? docId(path) : `c:${hex(path)}:${chunk}`;
}

export function chunks(text: string): string[] {
  const found: string[] = [];
  let start = 0;
  while (start < text.length && found.length < CHUNKS_MAX) {
    const end = cut(text, start);
    const piece = text.slice(start, end).trim();
    if (piece) found.push(piece);
    if (end >= text.length) break;
    start = Math.max(start + 1, resume(text, end - OVERLAP_CHARS, end));
  }
  return found;
}

export function junk(piece: string) {
  if (piece.length < JUNK_MIN) return false;
  let longest = 0;
  for (const run of piece.split(/\s+/)) longest = Math.max(longest, run.length);
  return longest > piece.length * JUNK_SHARE;
}

function cut(text: string, start: number) {
  const end = start + CHUNK_CHARS;
  if (end >= text.length) return text.length;
  const floor = start + CHUNK_CHARS / 2;
  for (const mark of BREAKS) {
    const at = text.lastIndexOf(mark, end - mark.length);
    if (at >= floor) return at + mark.length;
  }
  return end;
}

function resume(text: string, from: number, end: number) {
  const space = text.indexOf(" ", from);
  return space === -1 || space >= end ? from : space + 1;
}

function hex(path: string) {
  return blake3(Buffer.from(path)).toString("hex");
}
