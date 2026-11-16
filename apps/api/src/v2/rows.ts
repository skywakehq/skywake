import type { indexes } from "@skywake/contract";

import { invalid } from "./errors.ts";

type Schema = indexes.IndexSchema;
type Attribute = Schema["attributes"][number];
type Vector = Schema["vectors"][number];
export type Row = Record<string, unknown> & { id: string | number };
export type Doc = {
  id: string | number;
  vectors: Record<string, unknown>;
  attributes: Record<string, unknown>;
};

export const MEANING = "_meaning";
const EMBED_FIRST = ["text", "content", "body", "description", "title", "name"];

const isVector = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === "number");

function typeOf(value: unknown): Attribute["type"] | null {
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "bool";
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) {
    return "strings";
  }
  return null;
}

function column(name: string, type: Attribute["type"]): Attribute {
  return type === "text" ? { name, type, filterable: true } : { name, type };
}

export function fieldsOf(rows: Row[], schema: Pick<Schema, "attributes" | "vectors">) {
  const known = new Map<string, string>([
    ...schema.attributes.map((c) => [c.name, c.type] as const),
    ...schema.vectors.map((c) => [c.name, "vector"] as const),
  ]);
  const attributes = new Map<string, Attribute>();
  const vectors = new Map<string, number>();
  rows.forEach((row, i) => {
    for (const [name, value] of Object.entries(row)) {
      if (name === "id" || value === null || value === undefined || known.has(name)) continue;
      const at = `rows[${i}].${name}`;
      if (isVector(value)) {
        const dims = vectors.get(name);
        if (dims !== undefined && dims !== value.length) {
          throw invalid(`has ${value.length} numbers, but rows above have ${dims}`, at);
        }
        vectors.set(name, value.length);
        continue;
      }
      const type = typeOf(value);
      if (!type) {
        throw invalid(
          "is not a string, number, bool, list of strings or vector",
          at,
          "flatten objects into fields, such as `author_name`",
        );
      }
      const before = attributes.get(name)?.type;
      if (before && before !== type) throw invalid(`is ${type}, but rows above give ${before}`, at);
      attributes.set(name, column(name, type));
    }
  });
  return { attributes: [...attributes.values()], vectors };
}

export function firstSchema(rows: Row[], embed: { model: string; dims: number } | null): Schema {
  const found = fieldsOf(rows, { attributes: [], vectors: [] });
  const vectors: Vector[] = [...found.vectors].map(([name, dims]) => ({
    name,
    dims,
    metric: "cosine",
  }));
  const texts = found.attributes.filter((c) => c.type === "text").map((c) => c.name);
  if (vectors.length === 0 && embed && texts.length > 0) {
    const from = EMBED_FIRST.find((name) => texts.includes(name)) ?? texts[0]!;
    vectors.push({
      name: MEANING,
      dims: embed.dims,
      metric: "cosine",
      embed: { model: embed.model, from },
    });
  }
  if (vectors.length === 0 && texts.length === 0) {
    throw invalid(
      "the rows have no string field to search and no vector",
      "rows",
      "add a `text` field, or a list of numbers as a vector",
    );
  }
  return { vectors, attributes: found.attributes };
}

export function docOf(schema: Schema, row: Row): Doc {
  const vectorNames = new Set(schema.vectors.map((c) => c.name));
  const vectors: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    if (name === "id" || value === undefined || value === null) continue;
    if (vectorNames.has(name)) vectors[name] = value;
    else attributes[name] = value;
  }
  return { id: row.id, vectors, attributes };
}

export function rowOf(doc: { id: string | number; attributes?: Record<string, unknown> }): Row {
  return { id: doc.id, ...doc.attributes };
}

export const embedColumn = (schema: Schema) => schema.vectors.find((c) => c.embed);

export function vectorColumn(schema: Schema, dims: number) {
  return (
    schema.vectors.find((c) => c.dims === dims && c.name !== MEANING) ??
    schema.vectors.find((c) => c.dims === dims)
  );
}

export const textFields = (schema: Schema) =>
  schema.attributes.filter((c) => c.type === "text").map((c) => c.name);
