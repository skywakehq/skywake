import type { IndexScore } from "@skywake/engine";

import { invalidAt } from "../../../http/errors.ts";
import { filter } from "./filters.ts";
import { at, isObject, isSparse, isVectors, named, type Kind, type Kinds } from "./kinds.ts";

const SCORE_LISTS = ["sum", "product", "max", "min"];
const SCORED: readonly Kind[] = ["number", "int", "datetime", "bool"];

/** Checks a score expression; see `indexes.Score`. */
export function score(kinds: Kinds, searches: string[], input: unknown, path: string): IndexScore {
  if (typeof input === "number") return input;
  const keys = isObject(input) ? Object.keys(input) : [];
  if (keys.length !== 1) throw invalidAt(path, "a score is a number or an object with one key");
  const key = keys[0]!;
  const inner = (input as Record<string, unknown>)[key];
  const here = at(path, key);
  const nested = (value: unknown, name: string) => score(kinds, searches, value, at(here, name));
  const positive = (name: string) => {
    const value = isObject(inner) ? inner[name] : undefined;
    if (typeof value !== "number" || value <= 0)
      throw invalidAt(at(here, name), "must be more than 0");
  };
  if (key === "search") {
    if (typeof inner !== "string" || !searches.includes(inner))
      throw invalidAt(here, "names no search");
  } else if (key === "attribute") {
    const kind = typeof inner === "string" ? kinds.get(inner) : undefined;
    if (!kind || !SCORED.includes(kind)) {
      throw invalidAt(here, "takes a number, int, datetime or bool attribute");
    }
  } else if (SCORE_LISTS.includes(key)) {
    if (!Array.isArray(inner) || inner.length === 0)
      throw invalidAt(here, "takes a list of scores");
    inner.forEach((item, i) => score(kinds, searches, item, at(here, i)));
  } else if (key === "dot" || key === "max_sim") {
    const kind = key === "dot" ? "sparse" : "vectors";
    const { attribute, ...value } = isObject(inner) ? inner : {};
    if (typeof attribute !== "string" || kinds.get(attribute) !== kind) {
      throw invalidAt(at(here, "attribute"), `takes a ${kind} attribute`);
    }
    if (key === "max_sim") {
      if (!isVectors(value.vectors)) throw invalidAt(at(here, "vectors"), named("vectors"));
      return input as IndexScore;
    }
    if (!isSparse(value) || (value.indices as unknown[]).length === 0) {
      throw invalidAt(here, named("sparse"));
    }
    // The engine takes them by rising index.
    const pairs = (value.indices as number[]).map((i, n) => [i, (value.values as number[])[n]!]);
    pairs.sort(([a], [b]) => a! - b!);
    return {
      dot: { attribute, indices: pairs.map(([i]) => i!), values: pairs.map(([, x]) => x!) },
    };
  } else if (key === "filter") {
    filter(kinds, inner, here, "vector");
  } else if (key === "dist" || key === "pow") {
    if (!isObject(inner)) throw invalidAt(here, "takes an object");
    nested(inner.of, "of");
    if (key === "dist" && typeof inner.origin !== "number") {
      throw invalidAt(at(here, "origin"), "takes a number");
    }
    if (key === "pow") positive("exponent");
  } else if (key === "decay" || key === "saturate") {
    if (!isObject(inner)) throw invalidAt(here, "takes an object");
    nested(inner.of, "of");
    if (key === "decay") {
      if (typeof inner.origin !== "number") throw invalidAt(at(here, "origin"), "takes a number");
      positive("scale");
    } else {
      positive("k");
    }
  } else {
    throw invalidAt(
      here,
      "no such score; use search, attribute, sum, product, max, min, decay, saturate, dist, pow, filter, dot or max_sim",
    );
  }
  return input as IndexScore;
}
