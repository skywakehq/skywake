import type { indexes } from "@skywake/contract";
import type { IndexDoc } from "@skywake/engine";

import type { SearchIndex } from "../../auth/access.ts";
import type { Ctx } from "../../http/context.ts";
import { invalidAt } from "../../http/errors.ts";
import type { Columns } from "./schema.ts";

type Schema = indexes.IndexSchema;
type Patch = NonNullable<indexes.Write["patches"]>[number];

export async function sized(c: Ctx, schema: Schema | undefined, columns: Columns) {
  const vectors = await Promise.all(
    columns.vectors.map(async (column) => {
      if (column.dims > 0) return column;
      const have = schema?.vectors.find((known) => known.name === column.name);
      if (have) return { ...column, dims: have.dims };
      const [probe] = await c.var.services.models.embed(column.embed!.model, ["dims"]);
      return { ...column, dims: probe!.length };
    }),
  );
  return { ...columns, vectors };
}

export async function reembedded(
  index: SearchIndex,
  branch: string,
  patches: Patch[],
  conditional: boolean,
): Promise<{ patches: Patch[]; upserts: indexes.Document[] }> {
  const sources = new Map(
    index.schema.vectors.flatMap((c) => (c.embed?.from ? [[c.embed.from, c.name] as const] : [])),
  );
  const touches = (patch: Patch) => Object.keys(patch.attributes).some((k) => sources.has(k));
  const changed = patches.filter(touches);
  if (changed.length === 0) return { patches, upserts: [] };
  if (conditional) {
    throw invalidAt("patch_condition", "a patch of an embedded attribute takes no condition");
  }
  const docs = new Map(
    (
      await index.store.getMany(
        branch,
        changed.map((p) => p.id),
      )
    ).map((d) => [d.id, d]),
  );
  const upserts = changed.flatMap((patch) => {
    const doc = docs.get(patch.id);
    return doc ? [merged(doc, patch, sources)] : [];
  });
  return { patches: patches.filter((p) => !touches(p)), upserts };
}

function merged(doc: IndexDoc, patch: Patch, sources: Map<string, string>): indexes.Document {
  const attributes: Record<string, unknown> = { ...doc.attributes };
  const vectors: Record<string, number[]> = { ...(doc.vectors as Record<string, number[]>) };
  for (const [key, value] of Object.entries(patch.attributes)) {
    if (value === null) delete attributes[key];
    else attributes[key] = value;
    if (sources.has(key)) delete vectors[sources.get(key)!];
  }
  return { id: doc.id, vectors, attributes: attributes as indexes.Document["attributes"] };
}
