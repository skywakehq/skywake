import type { indexes } from "@skywake/contract";
import type { AttributeValue, IndexDoc, IndexWrite } from "@skywake/engine";

import { badRequest, invalidAt } from "../../../http/errors.ts";
import type { Texts } from "../embeddings.ts";
import { filter, optionalFilter } from "./filters.ts";
import {
  at,
  fits,
  flatten,
  isUuid,
  kindsOf,
  named,
  valueKindsOf,
  type Kind,
  type Schema,
} from "./kinds.ts";

type Column = Schema["vectors"][number];
/** Attributes a patch sets; `null` removes one. */
type Changes = Record<string, AttributeValue | null>;

/** In an index of UUID ids, each of `ids` must be one. */
export function checkIds(schema: Schema, ids: unknown[], path: string) {
  if (schema.id !== "uuid") return;
  ids.forEach((id, i) => {
    if (!isUuid(id)) throw invalidAt(at(path, i), "must be a UUID");
  });
}

/** Checks each document's vectors and attributes. Texts given for vectors go to `texts`. */
export function documents(
  schema: Schema,
  docs: indexes.Document[],
  texts: Texts,
  path = "documents",
): IndexDoc[] {
  const columns = new Map(schema.vectors.map((column) => [column.name, column]));
  const kinds = kindsOf(schema);
  return docs.map((doc, i) => {
    const here = at(path, i);
    if (kinds.uuidIds && !isUuid(doc.id)) throw invalidAt(at(here, "id"), "must be a UUID");
    const vectors: IndexDoc["vectors"] = {};
    for (const [name, value] of Object.entries(doc.vectors)) {
      const column = columns.get(name);
      const field = at(at(here, "vectors"), name);
      if (!column) throw invalidAt(field, "no such vector column");
      vectors[name] = vector(column, value, field, texts);
    }
    const values = flatten(doc.attributes ?? {});
    for (const [name, column] of columns) {
      if (name in doc.vectors) continue;
      const from = column.embed?.from;
      const text = from === undefined ? undefined : values[from];
      if (typeof text !== "string" || text === "") {
        throw invalidAt(
          at(here, "vectors"),
          from === undefined
            ? `missing vector \`${name}\``
            : `missing vector \`${name}\`, or text in \`${from}\` to embed`,
        );
      }
      vectors[name] = texts.vector(column, text, at(at(here, "attributes"), from!));
    }
    attributes(valueKindsOf(schema), values, at(here, "attributes"), false);
    return { id: doc.id, vectors, attributes: values as Record<string, AttributeValue> };
  });
}

/** Checks attribute values; a patch removes one with `null`. */
function attributes(
  kinds: Map<string, Kind>,
  values: Record<string, unknown>,
  path: string,
  patch: boolean,
) {
  for (const [name, value] of Object.entries(values)) {
    const kind = kinds.get(name);
    const field = at(path, name);
    if (!kind) throw invalidAt(field, "no such attribute");
    if (patch && value === null) continue;
    if (!fits(kind, value)) throw invalidAt(field, `must be ${named(kind)}`);
  }
}

/** A patch can't change an attribute a vector is embedded from: the vector would be stale. */
function embedded(schema: Schema, values: Record<string, unknown>, path: string) {
  const column = schema.vectors.find((c) => c.embed?.from && c.embed.from in values);
  if (column) {
    throw invalidAt(
      at(path, column.embed!.from!),
      `vector \`${column.name}\` is embedded from it; upsert the document to change it`,
    );
  }
}

/** The write as the engine takes it. Texts given for vectors go to `texts`. */
export function write(schema: Schema, body: indexes.Write, texts: Texts): IndexWrite {
  const kinds = kindsOf(schema);
  const upserts = documents(schema, body.upserts ?? [], texts, "upserts");
  checkIds(schema, body.deletes ?? [], "deletes");
  const patches = body.patches?.map((patch, i) => {
    if (kinds.uuidIds && !isUuid(patch.id)) {
      throw invalidAt(at(at("patches", i), "id"), "must be a UUID");
    }
    const values = flatten(patch.attributes);
    attributes(valueKindsOf(schema), values, at(at("patches", i), "attributes"), true);
    embedded(schema, values, at(at("patches", i), "attributes"));
    return { id: patch.id, attributes: values as Changes };
  });
  const patchBy = body.patchBy && flatten(body.patchBy.attributes);
  if (patchBy) attributes(valueKindsOf(schema), patchBy, "patchBy.attributes", true);
  if (patchBy) embedded(schema, patchBy, "patchBy.attributes");
  const parts = [body.upserts, body.patches, body.deletes].map((list) => list?.length ?? 0);
  if (parts.every((n) => n === 0) && !body.deleteBy && !body.patchBy) {
    throw badRequest("a write needs upserts, patches, deletes, deleteBy or patchBy");
  }
  return {
    upserts,
    patches,
    deletes: body.deletes,
    returnAffectedIds: body.returnAffectedIds,
    upsertIf: optionalFilter(kinds, body.upsertIf, "upsertIf", "vector", true),
    patchIf: optionalFilter(kinds, body.patchIf, "patchIf", "vector", true),
    deleteIf: optionalFilter(kinds, body.deleteIf, "deleteIf", "vector", true),
    deleteBy: optionalFilter(kinds, body.deleteBy, "deleteBy", "vector"),
    patchBy: body.patchBy && {
      filter: filter(kinds, body.patchBy.filter, "patchBy.filter", "vector"),
      attributes: patchBy as Changes,
    },
  };
}

/** A vector of `column`: numbers as they are, or text or an image that goes to `texts`. */
export function vector(column: Column, value: indexes.VectorValue, path: string, texts: Texts) {
  if (!Array.isArray(value)) return texts.vector(column, value, path);
  if (value.length !== column.dims) {
    throw invalidAt(path, `has ${value.length} numbers, not ${column.dims}`);
  }
  if (
    column.element === "i8" &&
    !value.every((x) => Number.isInteger(x) && x >= -128 && x <= 127)
  ) {
    throw invalidAt(path, "takes whole numbers from -128 to 127");
  }
  return value;
}
