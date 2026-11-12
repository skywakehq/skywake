import { indexes } from "@skywake/contract";

import { invalidAt } from "../../http/errors.ts";

type Schema = indexes.IndexSchema;
type Vector = Schema["vectors"][number];
type Attribute = Schema["attributes"][number];

const METRICS = { cosine_distance: "cosine", euclidean_squared: "euclidean" } as const;
const NAMES = { cosine: "cosine_distance", euclidean: "euclidean_squared", dot: "dot_product" };

const KINDS: Record<string, Attribute["type"]> = {
  string: "string",
  bytes: "string",
  int: "int",
  uint: "int",
  float: "number",
  bool: "bool",
  uuid: "uuid",
  datetime: "datetime",
  "[]string": "strings",
  "[]int": "ints",
  "[]uint": "ints",
  "[]float": "numbers",
  "{}f16": "sparse",
};

const TYPES: Partial<Record<Attribute["type"], string>> = {
  string: "string",
  text: "string",
  int: "int",
  number: "float",
  bool: "bool",
  uuid: "uuid",
  datetime: "datetime",
  strings: "[]string",
  ints: "[]int",
  numbers: "[]float",
  sparse: "{}f16",
};

const VECTOR = /^\[(\d+)\](f32|f16|i8)$/;
const MULTI_VECTOR = /^\[\]\[\d+\]f32$/;

export function metricOf(name: unknown, path: string): Vector["metric"] | undefined {
  if (name === undefined || name === null) return undefined;
  const metric = METRICS[name as keyof typeof METRICS];
  if (!metric) throw invalidAt(path, "takes `cosine_distance` or `euclidean_squared`");
  return metric;
}

export const ourName = (name: string) => (name.startsWith("$embed_") ? name.slice(1) : name);

export function vectorName(schema: Schema, name: string) {
  const plain = ourName(name);
  if (schema.vectors.some((column) => column.name === plain)) return plain;
  return schema.vectors.find((column) => column.embed?.from === name)?.name ?? plain;
}

export const isVectorKey = (schema: Schema, key: string) =>
  key === "vector" || schema.vectors.some((column) => column.name === ourName(key));

export interface Columns {
  vectors: Vector[];
  attributes: Attribute[];
  drops: string[];
}

export function columnsOf(input: unknown, metric: Vector["metric"] | undefined): Columns {
  const vectors: Vector[] = [];
  const attributes: Attribute[] = [];
  const drops: string[] = [];
  if (input === undefined || input === null) return { vectors, attributes, drops };
  if (typeof input !== "object" || Array.isArray(input)) {
    throw invalidAt("schema", "is an object of attributes");
  }
  for (const [name, entry] of Object.entries(input)) {
    const path = `schema.${name}`;
    const config = (typeof entry === "string" ? { type: entry } : entry) as Record<string, unknown>;
    if (config.drop === true) {
      if (Object.keys(config).length > 1) throw invalidAt(path, "`drop` takes no other keys");
      drops.push(name);
      continue;
    }
    const type = String(config.type ?? "");
    const vector = VECTOR.exec(type);
    if (vector) {
      const ann = typeof config.ann === "object" && config.ann ? config.ann : {};
      const own = metricOf((ann as { distance_metric?: unknown }).distance_metric, path);
      const element = vector[2] as Vector["element"];
      const column: Vector = { name, dims: Number(vector[1]), metric: own ?? metric ?? "cosine" };
      vectors.push(element === "f32" ? column : { ...column, element });
      continue;
    }
    if (MULTI_VECTOR.test(type)) {
      attributes.push({ name, type: "vectors" });
      continue;
    }
    const kind = KINDS[type];
    if (!kind) throw invalidAt(path, `type \`${type}\` is not supported`);
    if (config.embed) {
      if (kind !== "string") throw invalidAt(`${path}.embed`, "embeds only a string attribute");
      vectors.push(embedColumn(name, config.embed, metric, `${path}.embed`));
    }
    const search = config.full_text_search;
    if (search && (kind === "string" || kind === "strings")) {
      attributes.push(textColumn(name, kind, search, config.filterable === true, path));
      continue;
    }
    attributes.push({ name, type: kind });
  }
  return { vectors, attributes, drops };
}

function embedColumn(
  name: string,
  input: unknown,
  metric: Vector["metric"] | undefined,
  path: string,
): Vector {
  const config = (typeof input === "string" ? { model: input } : input) as {
    model?: unknown;
    attribute?: unknown;
    dims?: unknown;
  };
  if (typeof config.model !== "string" || config.model === "") {
    throw invalidAt(path, "takes a model, or {model, attribute?, dims?}");
  }
  const column = typeof config.attribute === "string" ? config.attribute : `embed_${name}`;
  const known = indexes.embeddingModel(config.model);
  const dims = config.dims === undefined ? (known?.dims ?? 0) : Number(config.dims);
  if (!Number.isInteger(dims) || dims < 0) throw invalidAt(`${path}.dims`, "is a whole number");
  if (known && !known.sizes.includes(dims)) {
    throw invalidAt(
      `${path}.dims`,
      `model \`${known.id}\` gives ${known.sizes.join(", ")} numbers`,
    );
  }
  return {
    name: ourName(column),
    dims,
    metric: metric ?? "cosine",
    embed: { model: config.model, from: name },
  };
}

const STOPWORDS = new Set([
  "english",
  "danish",
  "dutch",
  "finnish",
  "french",
  "german",
  "hungarian",
  "italian",
  "norwegian",
  "portuguese",
  "russian",
  "spanish",
  "swedish",
]);

function textColumn(
  name: string,
  kind: Attribute["type"],
  search: unknown,
  filterable: boolean,
  path: string,
): Attribute {
  const config = (typeof search === "object" ? search : {}) as Record<string, unknown>;
  const column: Attribute = { name, type: "text", stemming: config.stemming === true };
  if (typeof config.k1 === "number") column.k1 = config.k1;
  if (typeof config.b === "number") column.b = config.b;
  const language = typeof config.language === "string" ? config.language : "english";
  column.language = language as Attribute["language"];
  if (config.remove_stopwords !== false && STOPWORDS.has(language)) column.stopwords = true;
  if (filterable) column.filterable = true;
  if (config.case_sensitive === true) column.case_sensitive = true;
  if (config.ascii_folding === true) column.ascii_folding = true;
  if (typeof config.max_token_length === "number")
    column.max_token_length = config.max_token_length;
  const listed = config.tokenizer === "pre_tokenized_array";
  if (listed !== (kind === "strings")) {
    throw invalidAt(
      `${path}.full_text_search.tokenizer`,
      "`pre_tokenized_array` goes with type `[]string`, and only with it",
    );
  }
  if (listed) column.pre_tokenized = true;
  return column;
}

export function shownSchema(schema: Schema) {
  const shown: Record<string, Record<string, unknown>> = {};
  const embeds = new Map<string, Record<string, unknown>>();
  for (const column of schema.vectors) {
    const name = column.name;
    shown[name] = {
      type: `[${column.dims}]${column.element ?? "f32"}`,
      ann: { distance_metric: NAMES[column.metric] },
    };
    const from = column.embed?.from;
    if (from) {
      const named = name === `embed_${from}` ? {} : { attribute: name };
      embeds.set(from, { model: column.embed!.model, ...named, dims: column.dims });
    }
  }
  for (const column of schema.attributes) {
    if (column.type === "vectors") {
      shown[column.name] = { type: "[][]f32", ann: { late_interaction: true } };
      continue;
    }
    const type = TYPES[column.type]!;
    const embed = embeds.has(column.name) ? { embed: embeds.get(column.name) } : {};
    if (column.type === "text") {
      shown[column.name] = {
        type: column.pre_tokenized ? "[]string" : type,
        filterable: !!column.filterable,
        full_text_search: {
          k1: column.k1 ?? 1.2,
          b: column.b ?? 0.75,
          language: column.language ?? "english",
          remove_stopwords: !!column.stopwords,
          stemming: column.stemming ?? true,
          case_sensitive: !!column.case_sensitive,
          ascii_folding: !!column.ascii_folding,
          max_token_length: column.max_token_length ?? 39,
          tokenizer: column.pre_tokenized ? "pre_tokenized_array" : "word_v3",
        },
        ...embed,
      };
      continue;
    }
    shown[column.name] = {
      type,
      filterable: column.type !== "sparse",
      ...(column.type === "sparse" ? { sparse_knn: { distance_metric: "dot_product" } } : {}),
      ...embed,
    };
  }
  return shown;
}
