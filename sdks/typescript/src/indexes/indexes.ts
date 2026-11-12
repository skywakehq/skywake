import type { Client, Schemas } from "../core/api.js";
import { unwrap } from "../core/errors.js";
import { everything, type Page } from "../core/paging.js";
import { SearchIndex } from "./search-index.js";
import type { NewIndexOptions } from "./types.js";

/** The organization's indexes. */
export class Indexes {
  constructor(readonly client: Client) {}

  /** Makes an index with an empty `main` branch. */
  async create(
    name: string,
    schema: Schemas["IndexSchema"],
    options: NewIndexOptions = {},
  ): Promise<SearchIndex> {
    const { ifMissing, ...rest } = options;
    const answer = await this.client.POST("/indexes", { body: { name, schema, ...rest } });
    if (!(ifMissing && answer.response.status === 409)) unwrap(answer);
    return new SearchIndex(this.client, name);
  }

  /** One page of indexes, in name order. */
  async list(page: Page = {}): Promise<Schemas["Index"][]> {
    return unwrap(await this.client.GET("/indexes", { params: { query: page } }));
  }

  /** Every index, a page at a time. */
  all(): AsyncGenerator<Schemas["Index"], void, undefined> {
    return everything(
      (page) => this.list(page),
      (index) => index.name,
    );
  }

  /** The schema, and the counts of `main`. */
  async get(name: string): Promise<Schemas["IndexInfo"]> {
    const params = { path: { index: name } };
    return unwrap(await this.client.GET("/indexes/{index}", { params }));
  }

  /** Queries, writes and size per day over the last `days` days (14 by default), oldest first. */
  async usage(name: string, days?: number): Promise<Schemas["IndexUsageDay"][]> {
    const params = { path: { index: name }, query: { days } };
    return unwrap(await this.client.GET("/indexes/{index}/usage", { params })).days;
  }

  /**
   * Adds attributes, makes the index read-only or writable again, or pins it to
   * servers (`pinned: null` unpins it), on every branch. An attribute it has must
   * keep its type.
   */
  async update(name: string, update: Schemas["UpdateIndex"]): Promise<Schemas["Index"]> {
    const params = { path: { index: name } };
    return unwrap(await this.client.PATCH("/indexes/{index}", { params, body: update }));
  }

  /** Deletes the index, every branch and all its data. */
  async delete(name: string): Promise<void> {
    const params = { path: { index: name } };
    unwrap(await this.client.DELETE("/indexes/{index}", { params }));
  }
}
