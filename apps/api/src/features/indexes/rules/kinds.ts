// Attribute kinds, and whether a value is one of them.

import type { indexes } from "@skywake/contract";

export type Schema = indexes.IndexSchema;
export type Kind = Schema["attributes"][number]["type"];

/**
 * Attribute kinds by name, whether every id is a UUID, and for each text
 * attribute the kind it filters as, if it filters by its whole value.
 */
export type Kinds = Map<string, Kind> & { uuidIds: boolean; plain: Map<string, Kind> };

export const kindsOf = (schema: Schema): Kinds =>
  Object.assign(new Map(schema.attributes.map((c) => [c.name, c.type])), {
    uuidIds: schema.id === "uuid",
    plain: new Map(
      schema.attributes
        .filter((c) => c.type === "text" && c.filterable)
        .map((c): [string, Kind] => [c.name, c.pre_tokenized ? "strings" : "string"]),
    ),
  });

/** The kind of each document value: a pre-tokenized text attribute is a list. */
export const valueKindsOf = (schema: Schema) =>
  new Map(
    schema.attributes.map((c): [string, Kind] => [c.name, c.pre_tokenized ? "strings" : c.type]),
  );

/** The kind an attribute filters, orders and groups as. */
export const plainKind = (kinds: Kinds, name: string) => kinds.plain.get(name) ?? kinds.get(name);

export const at = (path: string, key: string | number) =>
  typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`;

/** The path of a field of the request at `path`; the top when `path` is empty. */
export const under = (path: string) => (key: string) => (path ? at(path, key) : key);

const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ].+)?$/;

export const isUuid = (value: unknown) => typeof value === "string" && UUID.test(value);

/** The kind of each item of a list attribute, and of the others themselves. */
export const ITEM: Record<Kind, Kind> = {
  string: "string",
  number: "number",
  int: "int",
  bool: "bool",
  uuid: "uuid",
  datetime: "datetime",
  strings: "string",
  ints: "int",
  numbers: "number",
  sparse: "sparse",
  vectors: "vectors",
  text: "string",
};

export const isList = (kind: Kind) => ITEM[kind] !== kind && kind !== "text";
/** Kinds only a score reads: never filtered, ordered or grouped by. */
export const scoredOnly = (kind: Kind) => kind === "sparse" || kind === "vectors";

/** Whether `value` is one of `kind`; the engine reads a UUID or time from its string. */
export function fits(kind: Kind, value: unknown): boolean {
  if (isList(kind)) return Array.isArray(value) && value.every((item) => fits(ITEM[kind], item));
  switch (kind) {
    case "string":
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "int":
      return Number.isSafeInteger(value);
    case "bool":
      return typeof value === "boolean";
    case "uuid":
      return isUuid(value);
    case "datetime":
      return Number.isSafeInteger(value) || (typeof value === "string" && DATE.test(value));
    case "sparse":
      return isSparse(value);
    case "vectors":
      return isVectors(value);
    default:
      return false;
  }
}

const KIND_NAMES: Partial<Record<Kind, string>> = {
  int: "a whole number",
  uuid: "a UUID",
  datetime: "an RFC 3339 time or milliseconds",
  strings: "a list of strings",
  ints: "a list of whole numbers",
  numbers: "a list of numbers",
  text: "a string",
  sparse: "`{indices, values}`: whole numbers from 0, each once, and finite numbers",
  vectors: "a list of vectors of one length",
};
export const named = (kind: Kind) => KIND_NAMES[kind] ?? `a ${kind}`;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x);

/** A sparse vector is an object of just `indices` and `values`. */
export const looksSparse = (value: unknown): value is { indices: unknown[]; values: unknown[] } =>
  isObject(value) &&
  Object.keys(value).length === 2 &&
  Array.isArray(value.indices) &&
  Array.isArray(value.values);

export function isSparse(value: unknown) {
  if (!looksSparse(value)) return false;
  const { indices, values } = value;
  const index = (x: unknown) =>
    Number.isInteger(x) && (x as number) >= 0 && (x as number) < 2 ** 32;
  return (
    indices.length === values.length &&
    indices.every(index) &&
    new Set(indices).size === indices.length &&
    values.every(finite)
  );
}

/** A list of arrays, any one of which makes the value `vectors`. */
export const looksVectors = (value: unknown): value is unknown[][] =>
  Array.isArray(value) && value.length > 0 && Array.isArray(value[0]);

export const isVectors = (value: unknown) =>
  looksVectors(value) &&
  value.every((v) => Array.isArray(v) && v.length === value[0]!.length && v.every(finite)) &&
  value[0]!.length > 0;

/**
 * An object's fields as attributes of their own: `{a: {b: 1}}` is
 * `{"a.b": 1}`. A sparse vector stays whole.
 */
export function flatten(
  values: Record<string, unknown>,
  prefix = "",
  out: Record<string, unknown> = {},
) {
  for (const [name, value] of Object.entries(values)) {
    if (isObject(value) && !looksSparse(value)) flatten(value, `${prefix}${name}.`, out);
    else out[prefix + name] = value;
  }
  return out;
}
