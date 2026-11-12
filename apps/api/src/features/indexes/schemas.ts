import { indexes as contract } from "@skywake/contract";

import type { SearchIndex } from "../../auth/access.ts";
import type { Db } from "../../db/client.ts";
import { badRequest, invalidAt, notFound } from "../../http/errors.ts";
import * as indexes from "./queries.ts";
import { flatten, looksSparse, looksVectors } from "./rules/index.ts";

type Schema = contract.IndexSchema;
type Attribute = Schema["attributes"][number];

export interface Written {
  values: Record<string, unknown>;
  path: string;
}

function typeOf(value: unknown): Attribute["type"] | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "bool";
  if (looksSparse(value)) return "sparse";
  if (looksVectors(value)) return "vectors";
  if (Array.isArray(value) && value.length > 0) {
    return typeof value[0] === "string" ? "strings" : "numbers";
  }
  return undefined;
}

export function newAttributes(schema: Schema, written: Written[]): Attribute[] {
  const known = new Set(schema.attributes.map((column) => column.name));
  const found = new Map<string, Attribute>();
  for (const { values, path } of written) {
    for (const [name, value] of Object.entries(flatten(values))) {
      const type = typeOf(value);
      if (known.has(name) || !type) continue;
      const field = `${path}.${name}`;
      const before = found.get(name)?.type;
      if (before && before !== type) throw invalidAt(field, `must be ${before}, as it is above`);
      const column = contract.AttributeColumn.safeParse({ name, type });
      if (!column.success) throw invalidAt(field, column.error.issues[0]!.message);
      found.set(name, column.data);
    }
  }
  return [...found.values()];
}

export const engineSchema = (schema: Schema) => ({
  vectors: schema.vectors.map(({ embed: _, ...column }) => column),
  attributes: schema.attributes.map(
    ({
      filter_index,
      case_sensitive,
      ascii_folding,
      max_token_length,
      pre_tokenized,
      ...column
    }) => ({
      ...column,
      filterIndex: filter_index,
      caseSensitive: case_sensitive,
      asciiFolding: ascii_folding,
      maxTokenLength: max_token_length,
      preTokenized: pre_tokenized,
    }),
  ),
  id: schema.id,
});

const same = (a: Attribute, b: Attribute) =>
  a.type === b.type &&
  a.k1 === b.k1 &&
  a.b === b.b &&
  (a.language ?? "english") === (b.language ?? "english") &&
  !!a.stopwords === !!b.stopwords &&
  (a.stemming ?? true) === (b.stemming ?? true) &&
  !!a.filterable === !!b.filterable &&
  !!a.case_sensitive === !!b.case_sensitive &&
  !!a.ascii_folding === !!b.ascii_folding &&
  (a.max_token_length ?? 39) === (b.max_token_length ?? 39) &&
  !!a.pre_tokenized === !!b.pre_tokenized;

export async function addAttributes(
  db: Db,
  index: SearchIndex,
  attributes: Attribute[],
): Promise<SearchIndex> {
  const known = new Map(index.schema.attributes.map((column) => [column.name, column]));
  const changed = attributes.find(
    (column) => known.has(column.name) && !same(known.get(column.name)!, column),
  );
  if (changed) throw badRequest(`attribute \`${changed.name}\` can't change its type`);
  const added = attributes.filter((column) => !known.has(column.name));
  const indexed = new Set(
    attributes
      .filter((column) => column.filter_index && known.has(column.name))
      .filter((column) => !known.get(column.name)!.filter_index)
      .map((column) => column.name),
  );
  if (added.length === 0 && indexed.size === 0) return index;
  const kept = index.schema.attributes.map((column) =>
    indexed.has(column.name) ? { ...column, filter_index: true } : column,
  );
  const checked = contract.IndexSchema.safeParse({
    ...index.schema,
    attributes: [...kept, ...added],
  });
  if (!checked.success) throw badRequest(checked.error.issues[0]!.message);
  const altered = [...kept.filter((column) => indexed.has(column.name)), ...added];
  const engine = engineSchema({ vectors: [], attributes: altered });
  for (const branch of await index.store.branches()) await index.store.alter(branch, engine);
  if (await indexes.setSchema(db, index, checked.data)) return { ...index, schema: checked.data };
  const row = await indexes.find(db, index.org, index.name);
  if (!row) throw notFound(`index \`${index.name}\``);
  return addAttributes(db, { ...index, ...row }, attributes);
}

export function firstSchema(docs: contract.Document[], path: string): Schema {
  const vectors = new Map<string, unknown>();
  docs.forEach((doc, i) => {
    for (const [name, value] of Object.entries(doc.vectors)) {
      const field = `${path}[${i}].vectors.${name}`;
      if (!Array.isArray(value)) throw invalidAt(field, "a new index takes vectors as numbers");
      if (!vectors.has(name)) vectors.set(name, { name, dims: value.length });
    }
  });
  const written = docs.map((doc, i) => ({
    values: doc.attributes ?? {},
    path: `${path}[${i}].attributes`,
  }));
  const schema = contract.IndexSchema.safeParse({
    vectors: [...vectors.values()],
    attributes: newAttributes({ vectors: [], attributes: [] }, written),
  });
  if (!schema.success) {
    throw badRequest(`the documents make no index: ${schema.error.issues[0]!.message}`);
  }
  return schema.data;
}

export async function dropAttributes(
  db: Db,
  index: SearchIndex,
  names: string[],
): Promise<SearchIndex> {
  const missing = names.find((name) => !index.schema.attributes.some((c) => c.name === name));
  if (missing) throw badRequest(`no attribute \`${missing}\``);
  const branches = await index.store.branches();
  if (branches.length > 1) {
    throw badRequest(
      `the index has ${branches.length} branches sharing its data; drop attributes before branching`,
    );
  }
  const checked = contract.IndexSchema.safeParse({
    ...index.schema,
    attributes: index.schema.attributes.filter((c) => !names.includes(c.name)),
  });
  if (!checked.success) throw badRequest(checked.error.issues[0]!.message);
  if (!(await indexes.setSchema(db, index, checked.data))) {
    const row = await indexes.find(db, index.org, index.name);
    if (!row) throw notFound(`index \`${index.name}\``);
    return dropAttributes(db, { ...index, ...row }, names);
  }
  for (const branch of branches) await index.store.dropAttributes(branch, names);
  return { ...index, schema: checked.data };
}
