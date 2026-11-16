import { indexes as contract } from "@skywake/contract";
import { blake3, type DocId, type Index, type IndexDoc, type IndexFilter } from "@skywake/engine";

import { conflict } from "../../http/errors.ts";
import type { Models } from "../indexes/models.ts";
import type { Input } from "../indexes/providers.ts";
import type * as indexes from "../indexes/queries.ts";
import type { IndexUsage } from "../indexes/usage.ts";
import { chunkId, chunks, junk } from "./chunks.ts";
import { gramsOf } from "./grams.ts";
import type { FileDoc } from "./reader.ts";

const BATCH_ROWS = 1_000;
const BATCH_BYTES = 24 << 20;
const CACHE_PAGE = 1_000;
export const SKIPPED_MAX = 50;

type Schema = indexes.IndexRow["schema"];
type Column = Schema["vectors"][number];
type Attributes = Record<string, string | number>;

interface Row {
  id: DocId;
  path: string;
  attributes: Attributes;
  input?: Input;
  hash?: string;
  vector?: number[];
}

export interface Skip {
  path: string;
  reason: string;
}

export interface Shape {
  column: Column | undefined;
  images: boolean;
  chunked: boolean;
  has: (name: string, type: string) => boolean;
}

export function shapeOf(schema: Schema): Shape {
  const has = (name: string, type: string) =>
    schema.attributes.some((column) => column.name === name && column.type === type);
  const plain = schema.vectors.find((column) => !column.embed);
  if (plain) {
    throw conflict(
      `vector column \`${plain.name}\` has no \`embed\` model, so a link can't fill it`,
    );
  }
  if (schema.vectors.length > 1) throw conflict("a linked index can have one vector column");
  const column = schema.vectors[0];
  const model = column && contract.embeddingModel(column.embed!.model);
  return { column, images: model?.images === true, chunked: has("chunk", "number"), has };
}

export class Writer {
  readonly #index: Index;
  readonly #branch: string;
  readonly #row: indexes.IndexRow;
  readonly #usage: IndexUsage;
  readonly #models: Models;
  readonly #shape: Shape;
  #rows: Row[] = [];
  #bytes = 0;
  #paths = new Set<string>();
  #folders: string[] = [];
  readonly skipped: Skip[] = [];
  readonly cleared = new Set<string>();
  #last: string | null = null;
  embedded = 0;
  onFlush: ((last: string | null) => Promise<void>) | undefined;

  constructor(
    index: Index,
    branch: string,
    row: indexes.IndexRow,
    usage: IndexUsage,
    models: Models,
    shape: Shape,
  ) {
    this.#index = index;
    this.#branch = branch;
    this.#row = row;
    this.#usage = usage;
    this.#models = models;
    this.#shape = shape;
  }

  async add(doc: FileDoc) {
    this.cleared.add(doc.path);
    if (doc.kind === "skipped") {
      this.#skip({ path: doc.path, reason: doc.reason });
      this.#paths.add(doc.path);
      return;
    }
    const rows = this.#rowsOf(doc);
    const sizes = rows.map(sizeOf);
    const bytes = sizes.reduce((sum, size) => sum + size, 0);
    if (this.#rows.length > 0 && !this.#fits(rows.length, bytes)) await this.flush();
    this.#paths.add(doc.path);
    for (const [i, row] of rows.entries()) {
      if (this.#rows.length > 0 && !this.#fits(1, sizes[i]!)) await this.flush();
      this.#rows.push(row);
      this.#bytes += sizes[i]!;
    }
    this.#last = doc.path;
  }

  #fits(rows: number, bytes: number) {
    return this.#rows.length + rows <= BATCH_ROWS && this.#bytes + bytes <= BATCH_BYTES;
  }

  remove(path: string) {
    this.cleared.add(path);
    this.#paths.add(path);
    this.removeUnder(path);
  }

  removeUnder(path: string) {
    if (path !== "") this.#folders.push(`${literal(path)}/*`);
  }

  async flush() {
    if (this.#rows.length === 0 && this.#paths.size === 0 && this.#folders.length === 0) return;
    const bill = this.#usage.bill(this.#row);
    if (this.#rows.length > 0) await bill.admit("writes");
    const rows = this.#shape.column ? await this.#vectors(bill) : this.#rows;
    const filters: IndexFilter[] = [
      ...(this.#paths.size > 0 ? [{ path: { in: [...this.#paths] } }] : []),
      ...this.#folders.map((glob) => ({ path: { glob } })),
    ];
    const upserts: IndexDoc[] = rows.map((row) => ({
      id: row.id,
      vectors: this.#shape.column ? { [this.#shape.column.name]: row.vector! } : {},
      attributes: row.attributes,
    }));
    const done = await this.#index.write(this.#branch, {
      upserts: upserts.length > 0 ? upserts : undefined,
      deleteBy: filters.length <= 1 ? filters[0] : { or: filters },
    });
    bill.count("writes", done.upserted);
    bill.count("deletes", done.deleted);
    bill.wrote(this.#bytes);
    this.#rows = [];
    this.#paths = new Set();
    this.#folders = [];
    this.#bytes = 0;
    await this.onFlush?.(this.#last);
  }

  #rowsOf(doc: Exclude<FileDoc, { kind: "skipped" }>): Row[] {
    const { has, column, chunked } = this.#shape;
    const first = this.#attributes(doc, 0);
    if (doc.kind === "image") {
      first.text = doc.path;
      return [this.#make(doc.path, 0, first, column && { image: doc.image })];
    }
    if (has("grams", "text")) first.grams = gramsOf(doc.text);
    const pieces = chunks(doc.text);
    const opening = column && (pieces[0] !== undefined && !junk(pieces[0]) ? pieces[0] : doc.path);
    first.text = chunked ? (pieces[0] ?? "") : doc.text;
    if (!chunked) return [this.#make(doc.path, 0, first, opening)];
    const rest = pieces.flatMap((piece, i) => {
      if (i === 0 || (column && junk(piece))) return [];
      const attributes = { ...this.#attributes(doc, i), text: piece };
      return [this.#make(doc.path, i, attributes, column && piece)];
    });
    return [this.#make(doc.path, 0, first, opening), ...rest];
  }

  #attributes(doc: FileDoc, chunk: number): Attributes {
    const { has } = this.#shape;
    return {
      path: doc.path,
      ...(has("chunk", "number") ? { chunk } : {}),
      ...(has("kind", "string") ? { kind: doc.kind } : {}),
    };
  }

  #make(path: string, chunk: number, attributes: Attributes, input?: Input): Row {
    const row: Row = { id: chunkId(path, chunk), path, attributes, input };
    const { column, has } = this.#shape;
    if (!column || input === undefined) return row;
    if (has("summary", "string")) attributes.summary = typeof input === "string" ? input : path;
    row.hash = hashOf(column, input);
    if (has("hash", "string")) attributes.hash = row.hash;
    return row;
  }

  async #vectors(bill: ReturnType<IndexUsage["bill"]>) {
    const column = this.#shape.column!;
    const known = await this.#cached(this.#rows.map((row) => row.hash!));
    const wanted = new Map<string, Row[]>();
    for (const row of this.#rows) {
      const vector = known.get(row.hash!);
      if (vector) row.vector = vector;
      else wanted.set(row.hash!, [...(wanted.get(row.hash!) ?? []), row]);
    }
    const asked = [...wanted.values()];
    if (asked.length > 0) {
      await bill.admit("embeddings");
      const vectors = await this.#embed(asked.map((rows) => rows[0]!.input!));
      asked.forEach((rows, i) => rows.forEach((row) => (row.vector = vectors[i] ?? undefined)));
      bill.count("embeddings", asked.length);
      this.embedded += asked.length;
    }
    const lost = this.#rows.filter((row) => !row.vector && row.id === chunkId(row.path, 0));
    if (lost.length > 0) {
      const again = await this.#embed(lost.map((row) => row.path));
      lost.forEach((row, i) => {
        row.vector = again[i] ?? undefined;
        this.#skip({
          path: row.path,
          reason: row.vector
            ? "the embedding provider refused it, so only its path is embedded"
            : "the embedding provider refused it",
        });
      });
    }
    const wrong = this.#rows.find((row) => row.vector && row.vector.length !== column.dims);
    if (wrong) {
      throw conflict(
        `model \`${column.embed!.model}\` gives ${wrong.vector!.length} numbers, ` +
          `but \`${column.name}\` has ${column.dims}`,
      );
    }
    return this.#rows.filter((row) => row.vector);
  }

  async #embed(inputs: Input[]) {
    const column = this.#shape.column!;
    return this.#models.embedEach(column.embed!.model, inputs, column.dims, "document");
  }

  async #cached(hashes: string[]) {
    const found = new Map<string, number[]>();
    if (!this.#shape.has("hash", "string")) return found;
    const name = this.#shape.column!.name;
    const unique = [...new Set(hashes)];
    for (let at = 0; at < unique.length; at += CACHE_PAGE) {
      const rows = await this.#index.order(this.#branch, {
        by: "hash",
        topK: CACHE_PAGE,
        filter: { hash: { in: unique.slice(at, at + CACHE_PAGE) } },
        include: ["hash"],
      });
      if (rows.length === 0) continue;
      const byId = new Map(
        rows.map((row) => [JSON.stringify(row.id), String(row.attributes.hash)]),
      );
      for (const doc of await this.#index.getMany(
        this.#branch,
        rows.map((row) => row.id),
      )) {
        const hash = byId.get(JSON.stringify(doc.id));
        const vector = doc.vectors[name];
        if (hash && vector) found.set(hash, vector);
      }
    }
    return found;
  }

  #skip(skip: Skip) {
    if (this.skipped.length < SKIPPED_MAX) this.skipped.push(skip);
  }
}

function hashOf(column: Column, input: Input) {
  const key = typeof input === "string" ? input : input.image;
  return blake3(Buffer.from(`${column.embed!.model}\0${column.dims}\0${key}`)).toString("hex");
}

export function literal(path: string) {
  return path.replace(/[*?[]/g, (c) => `[${c}]`);
}

function sizeOf(row: Row) {
  const text = Object.values(row.attributes).reduce<number>(
    (sum, value) => sum + (typeof value === "string" ? value.length : 8),
    0,
  );
  const image = row.input && typeof row.input !== "string" ? row.input.image.length : 0;
  return text + image;
}
