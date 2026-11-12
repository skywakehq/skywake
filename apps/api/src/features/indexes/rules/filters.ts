import { indexes } from "@skywake/contract";
import type { IndexFilter } from "@skywake/engine";

import { invalidAt } from "../../../http/errors.ts";
import {
  at,
  fits,
  isList,
  isObject,
  isUuid,
  ITEM,
  named,
  scoredOnly,
  type Kind,
  type Kinds,
} from "./kinds.ts";

type Op = (typeof indexes.FILTER_OPS)[number];

/** Where a filter is: `text` allows token filters on text here, `vector` never. */
export type Place = "vector" | "text" | "text-nested";

/** Checks a filter of keyword objects; see `indexes.Filter`. */
export function filter(
  kinds: Kinds,
  input: unknown,
  path: string,
  place: Place,
  // In a write's condition, a value may be `{"$ref_new": "<attribute>"}`.
  refs = false,
): IndexFilter {
  if (!isObject(input)) throw invalidAt(path, "a filter is an object");
  const keys = Object.keys(input);
  if (keys.length === 0) throw invalidAt(path, "a filter needs a condition");
  for (const key of keys) {
    const inner = input[key];
    const here = at(path, key);
    if (key === "and" || key === "or") {
      if (!Array.isArray(inner) || inner.length === 0) {
        throw invalidAt(here, "takes a list of filters");
      }
      // Phrases must hold for every hit, so only `and` keeps them allowed.
      const next = key === "and" || place === "vector" ? place : "text-nested";
      inner.forEach((item, i) => filter(kinds, item, at(here, i), next, refs));
    } else if (key === "not") {
      filter(kinds, inner, here, place === "vector" ? place : "text-nested", refs);
    } else {
      condition(kinds, key, inner, here, place, refs);
    }
  }
  return input as IndexFilter;
}

/** `filter`, for a request that may not have one. */
export const optionalFilter = (
  kinds: Kinds,
  input: unknown,
  path: string,
  place: Place,
  refs = false,
) => (input === undefined ? undefined : filter(kinds, input, path, place, refs));

function condition(
  kinds: Kinds,
  name: string,
  ops: unknown,
  path: string,
  place: Place,
  refs: boolean,
) {
  const kind = kinds.get(name);
  if (!kind && name !== "id") throw invalidAt(path, `no attribute \`${name}\``);
  if (!isObject(ops) || Object.keys(ops).length === 0) {
    throw invalidAt(path, `takes an operator, such as {"eq": ...}`);
  }
  if (!kind) return ids(ops, path, kinds.uuidIds);
  if (scoredOnly(kind)) throw invalidAt(path, `a ${kind} attribute is only scored`);
  const plain = kinds.plain.get(name);
  for (const [op, value] of Object.entries(ops)) {
    const here = at(path, op);
    if (op === "exists") {
      if (typeof value !== "boolean") throw invalidAt(here, "takes true or false");
    } else if (kind === "text" && (indexes.TEXT_OPS as readonly string[]).includes(op)) {
      if (place === "vector")
        throw invalidAt(here, "a text attribute matches words only in a search");
      if (place === "text-nested") throw invalidAt(here, "works only at the top or inside `and`");
      if (typeof value !== "string" || value.trim() === "") throw invalidAt(here, "takes words");
    } else if (kind === "text" && !plain) {
      throw invalidAt(
        here,
        `a text attribute takes ${indexes.TEXT_OPS.join(", ")} and exists, or the ops of a string once it is filterable`,
      );
    } else if (!(indexes.FILTER_OPS as readonly string[]).includes(op)) {
      throw invalidAt(here, `no operator \`${op}\`; use ${indexes.FILTER_OPS.join(", ")}`);
    } else {
      operator(kinds, plain ?? kind, op as Op, value, here, refs);
    }
  }
}

const ID_OPS = ["eq", "ne", "in", "not_in", "lt", "lte", "gt", "gte"];
const isId = (value: unknown) =>
  typeof value === "string" || (Number.isSafeInteger(value) && (value as number) >= 0);

/** An `id` condition: ids are strings or whole numbers from 0, or UUIDs. */
function ids(ops: Record<string, unknown>, path: string, uuid: boolean) {
  for (const [op, value] of Object.entries(ops)) {
    const here = at(path, op);
    if (!ID_OPS.includes(op)) throw invalidAt(here, `id takes ${ID_OPS.join(", ")}`);
    const list = op === "in" || op === "not_in";
    if (list && (!Array.isArray(value) || value.length === 0))
      throw invalidAt(here, "takes a list");
    const all = list ? (value as unknown[]) : [value];
    all.forEach((one, i) => {
      const where = list ? at(here, i) : here;
      if (uuid && !isUuid(one)) throw invalidAt(where, "must be a UUID");
      if (!isId(one)) throw invalidAt(where, "must be an id");
    });
  }
}

const LISTS: readonly Op[] = ["in", "not_in", "contains_all", "contains_any"];
const RANGES: readonly Op[] = ["lt", "lte", "gt", "gte"];
const PATTERNS: readonly Op[] = ["glob", "iglob", "regex"];

/** A list attribute compares by its items, so each op takes items. */
function operator(
  kinds: Map<string, Kind>,
  kind: Kind,
  op: Op,
  value: unknown,
  path: string,
  refs: boolean,
) {
  const item = ITEM[kind];
  if (op === "fuzzy") {
    if (item !== "string") throw invalidAt(path, "fuzzy matches only strings");
    if (!isFuzzy(value)) {
      throw invalidAt(path, 'takes {"text": "..", "edits": 0 to 2, "ignoreCase": true or false}');
    }
    return;
  }
  if (PATTERNS.includes(op)) {
    if (item !== "string") throw invalidAt(path, `${op} matches only strings`);
    if (typeof value !== "string" || value === "") throw invalidAt(path, "takes a pattern");
    return;
  }
  if (op.startsWith("contains_") && !isList(kind)) {
    throw invalidAt(path, `${op} takes a list attribute; use \`in\``);
  }
  if (RANGES.includes(op) && item === "bool")
    throw invalidAt(path, "a bool takes only eq, ne and in");
  if (LISTS.includes(op)) {
    if (!Array.isArray(value) || value.length === 0) throw invalidAt(path, "takes a list");
    value.forEach((one, i) => operand(kinds, item, one, at(path, i), refs));
  } else {
    operand(kinds, item, value, path, refs);
  }
}

function isFuzzy(value: unknown) {
  if (!isObject(value) || typeof value.text !== "string" || value.text === "") return false;
  const { edits = 1, ignoreCase = false } = value;
  return [0, 1, 2].includes(edits as number) && typeof ignoreCase === "boolean";
}

function operand(
  kinds: Map<string, Kind>,
  item: Kind,
  value: unknown,
  path: string,
  refs: boolean,
) {
  if (refs && isObject(value) && "$ref_new" in value) {
    const name = value.$ref_new;
    if (typeof name !== "string" || !kinds.has(name)) {
      throw invalidAt(at(path, "$ref_new"), "names no attribute");
    }
    return;
  }
  // An int compares with any number: `n < 2.5` is `n <= 2`.
  const want = item === "int" ? "number" : item;
  if (!fits(want, value)) throw invalidAt(path, `must be ${named(item)}`);
}
