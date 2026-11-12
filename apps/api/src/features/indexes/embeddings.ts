import type { indexes } from "@skywake/contract";

import { invalidAt } from "../../http/errors.ts";
import type { Models } from "./models.ts";
import type { Bill } from "./usage.ts";

type Column = indexes.IndexSchema["vectors"][number];

export type Input = string | { image: string };

interface Wanted {
  model: string;
  dims: number;
  input: Input;
  path: string;
  vector: number[];
}

export class Texts {
  #wanted: Wanted[] = [];

  vector(column: Column, input: Input, path: string): number[] {
    if (!column.embed) {
      throw invalidAt(
        path,
        `column \`${column.name}\` has no \`embed\` model, so it takes numbers`,
      );
    }
    const vector: number[] = [];
    this.#wanted.push({ model: column.embed.model, dims: column.dims, input, path, vector });
    return vector;
  }

  async embed(models: Models, bill: Bill) {
    if (this.#wanted.length === 0) return;
    await bill.admit("embeddings");
    const byModel = Map.groupBy(this.#wanted, (wanted) => `${wanted.dims} ${wanted.model}`);
    for (const wanted of byModel.values()) {
      const { model, dims } = wanted[0]!;
      const vectors = await models.embed(
        model,
        wanted.map((one) => one.input),
        dims,
      );
      wanted.forEach((one, i) => {
        const vector = vectors[i]!;
        if (vector.length !== one.dims) {
          throw invalidAt(
            one.path,
            `model \`${model}\` gives ${vector.length} numbers, but the column has ${one.dims}`,
          );
        }
        one.vector.push(...vector);
      });
    }
    bill.count("embeddings", this.#wanted.length);
  }
}
