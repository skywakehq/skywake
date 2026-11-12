import { invalidAt } from "../../http/errors.ts";

type Filter = Record<string, unknown>;
type Kinds = Map<string, string>;

const OPS: Record<string, string> = {
  Eq: "eq",
  NotEq: "ne",
  In: "in",
  NotIn: "not_in",
  Lt: "lt",
  Lte: "lte",
  Gt: "gt",
  Gte: "gte",
  AnyLt: "lt",
  AnyLte: "lte",
  AnyGt: "gt",
  AnyGte: "gte",
  ContainsAny: "contains_any",
  Glob: "glob",
  IGlob: "iglob",
  Regex: "regex",
  ContainsAllTokens: "contains_all_tokens",
  ContainsAnyToken: "contains_any_token",
  ContainsTokenSequence: "phrase",
};

const NEGATED: Record<string, string> = {
  NotContains: "contains_any",
  NotContainsAny: "contains_any",
  NotGlob: "glob",
  NotIGlob: "iglob",
};

export const FILTER_OPS = new Set([
  ...Object.keys(OPS),
  ...Object.keys(NEGATED),
  "Contains",
  "Fuzzy",
]);

const FUZZY_DEFAULT = [
  { distance: 1, min_query_chars: 6 },
  { distance: 2, min_query_chars: 9 },
];

export function filterOf(input: unknown, path: string, kinds: Kinds): Filter {
  if (!Array.isArray(input) || input.length < 2) {
    throw invalidAt(path, 'a filter is an array, such as ["tag", "Eq", "a"]');
  }
  const [head, op, value, options] = input as [unknown, unknown, unknown, unknown];
  if (head === "And" || head === "Or") {
    if (!Array.isArray(op)) throw invalidAt(path, `${head} takes a list of filters`);
    const key = head === "And" ? "and" : "or";
    return { [key]: op.map((inner, i) => filterOf(inner, `${path}[1][${i}]`, kinds)) };
  }
  if (head === "Not") return { not: filterOf(op, `${path}[1]`, kinds) };
  if (typeof head !== "string" || typeof op !== "string") {
    throw invalidAt(path, "takes an attribute and an operator");
  }
  if (value === null && (op === "Eq" || op === "NotEq")) {
    const present = presence(head, kinds, path);
    return op === "Eq" ? { not: present } : present;
  }
  if ((op === "Lt" || op === "Lte") && head !== "id") {
    if (value === null) return { not: presence(head, kinds, path) };
    return { or: [{ [head]: { [OPS[op]!]: value } }, { not: presence(head, kinds, path) }] };
  }
  if (op === "Contains") return { [head]: { contains_any: [value] } };
  if (NEGATED[op]) {
    const values = op === "NotContains" ? [value] : value;
    return { not: { [head]: { [NEGATED[op]]: values } } };
  }
  if (op === "Fuzzy") return fuzzy(head, value, options, path);
  if (op === "ContainsTokenSequence" || op === "ContainsAllTokens" || op === "ContainsAnyToken") {
    return tokens(head, op, value, options, path);
  }
  const ours = OPS[op];
  if (!ours) throw invalidAt(path, `operator \`${op}\` is not supported`);
  return { [head]: { [ours]: value } };
}

function tokens(name: string, op: string, value: unknown, options: unknown, path: string): Filter {
  const list = Array.isArray(value)
    ? (value as string[])
    : String(value).split(/\s+/).filter(Boolean);
  const prefix = (options as { last_as_prefix?: boolean } | undefined)?.last_as_prefix === true;
  if (!prefix) return { [name]: { [OPS[op]!]: list.join(" ") } };
  if (op === "ContainsTokenSequence") return { [name]: { prefix: list.join(" ") } };
  const rest = list.slice(0, -1).join(" ");
  const last = { [name]: { prefix: list.at(-1) ?? "" } };
  if (rest === "") return last;
  if (op === "ContainsAllTokens") return { and: [{ [name]: { contains_all_tokens: rest } }, last] };
  throw invalidAt(path, "ContainsAnyToken with last_as_prefix takes one word");
}

function fuzzy(name: string, value: unknown, options: unknown, path: string): Filter {
  if (typeof value !== "string") throw invalidAt(`${path}[2]`, "is a string");
  const config = (options ?? {}) as {
    max_edit_distance?: { distance: number; min_query_chars: number }[];
    case_sensitive?: boolean;
  };
  const steps = config.max_edit_distance ?? FUZZY_DEFAULT;
  const length = [...value].length;
  const edits = steps
    .filter((step) => length >= step.min_query_chars)
    .reduce((most, step) => Math.max(most, step.distance), 0);
  return {
    [name]: { fuzzy: { text: value, edits, ignoreCase: config.case_sensitive === false } },
  };
}

function presence(name: string, kinds: Kinds, path: string): Filter {
  if (!kinds.get(name)) throw invalidAt(path, `no attribute \`${name}\``);
  return { [name]: { exists: true } };
}
