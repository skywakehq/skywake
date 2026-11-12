import type { Client, Schemas } from "../core/api.js";
import { unwrap } from "../core/errors.js";
import { everything, type Page } from "../core/paging.js";
import type {
  Billing,
  Consistency,
  DocId,
  Document,
  DocumentCursor,
  DocumentPage,
  Group,
  IndexAggregate,
  IndexFilter,
  IndexHybrid,
  IndexMulti,
  IndexOrder,
  IndexQuery,
  IndexRank,
  IndexSearch,
  IndexVersion,
  IndexWrite,
  Measured,
  Operation,
  Patch,
  Performance,
  Ranked,
  Row,
  WriteCounts,
} from "./types.js";

/** The most documents or ids the API takes in one request. */
const BATCH = 1000;

/** One branch of a search index: `main` unless `at` picked another. */
export class SearchIndex {
  constructor(
    readonly client: Client,
    readonly name: string,
    readonly branch = "main",
  ) {}

  private get path() {
    return { index: this.name, branch: this.branch };
  }

  /** The same index on another branch. */
  at(branch: string): SearchIndex {
    return new SearchIndex(this.client, this.name, branch);
  }

  /**
   * Writes documents, 1000 to a request. Each replaces any earlier one with its id.
   * A vector may be text when its column has `embed`: the server embeds it.
   */
  async upsert(documents: Document[]): Promise<number> {
    const params = { path: this.path };
    return inBatches(documents, async (batch) => {
      const body = { documents: batch };
      return unwrap(
        await this.client.POST("/indexes/{index}/branches/{branch}/documents", { params, body }),
      ).count;
    });
  }

  /** Deletes documents by id. Ids that are not there are ignored. */
  async delete(ids: DocId[]): Promise<number> {
    const params = { path: this.path };
    return inBatches(ids, async (batch) => {
      const body = { ids: batch };
      return unwrap(
        await this.client.POST("/indexes/{index}/branches/{branch}/documents/delete", {
          params,
          body,
        }),
      ).count;
    });
  }

  /**
   * Upserts, patches and deletes as one change, with conditions such as
   * `upsertIf: {version: {lt: {$ref_new: "version"}}}`, and by filter.
   */
  async write(write: IndexWrite): Promise<WriteCounts> {
    const params = { path: this.path };
    return unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/write", { params, body: write }),
    );
  }

  /** Sets attributes of documents, and removes those set to `null`. Missing documents are skipped. */
  async patch(patches: Patch[]): Promise<number> {
    return inBatches(patches, async (batch) => (await this.write({ patches: batch })).patched);
  }

  /** Deletes every document that passes the filter. */
  async deleteBy(filter: IndexFilter): Promise<number> {
    return (await this.write({ deleteBy: filter })).deleted;
  }

  /** Documents in the order of an attribute, or of `id`. */
  async order(order: IndexOrder): Promise<Measured<Row>> {
    const params = { path: this.path };
    const answer = unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/order", { params, body: order }),
    );
    return measured(answer.rows, answer);
  }

  /**
   * Every document that passes the filter, best first by an exact score, such as
   * `{dot: {attribute, indices, values}}` for sparse vectors or
   * `{max_sim: {attribute, vectors}}` for late interaction.
   */
  async rank(rank: IndexRank): Promise<Measured<Ranked>> {
    const params = { path: this.path };
    const answer = unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/rank", { params, body: rank }),
    );
    return measured(answer.hits, answer);
  }

  /** Counts, sums, means, minimums and maximums: `{measures: {total: ["count"]}}`. */
  async aggregate(aggregate: IndexAggregate): Promise<Measured<Group>> {
    const params = { path: this.path };
    const answer = unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/aggregate", {
        params,
        body: aggregate,
      }),
    );
    return measured(answer.groups, answer);
  }

  /** Several queries, searches, orders and aggregations that see one snapshot. */
  async multi(
    requests: IndexMulti["requests"],
    options: { consistency?: Consistency } = {},
  ): Promise<Measured<Schemas["MultiResults"]["results"][number]>> {
    const params = { path: this.path };
    const answer = unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/multi", {
        params,
        body: { requests, ...options },
      }),
    );
    return measured(answer.results, answer);
  }

  /** Every document as it is now, streamed, in no set order. */
  async *export(): AsyncGenerator<Document, void, undefined> {
    const stream = await exported(this.client, this.path);
    const decoder = new TextDecoder();
    let rest = "";
    for await (const bytes of stream) {
      const lines = (rest + decoder.decode(bytes, { stream: true })).split("\n");
      rest = lines.pop()!;
      for (const line of lines) if (line) yield JSON.parse(line) as Document;
    }
    if (rest) yield JSON.parse(rest) as Document;
  }

  /** Every document as it is now, as the bytes of a Parquet file, streamed. */
  async *exportParquet(): AsyncGenerator<Uint8Array, void, undefined> {
    yield* await exported(this.client, this.path, { format: "parquet" });
  }

  /** Copies this branch to a new index, as its `main`. */
  async copy(
    name: string,
    options: { region?: string; encryption?: Schemas["IndexEncryption"] } = {},
  ): Promise<SearchIndex> {
    unwrap(
      await this.client.POST("/indexes/{index}/copy", {
        params: { path: { index: this.name } },
        body: { name, branch: this.branch, ...options },
      }),
    );
    return new SearchIndex(this.client, name);
  }

  /**
   * The nearest documents that pass the filter, nearest first. `vector.value` may be text
   * when the column has `embed`; `rerank` orders the hits again with a rerank model.
   */
  async query(query: IndexQuery): Promise<Measured<Schemas["Hit"]>> {
    const params = { path: this.path };
    const answer = unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/query", { params, body: query }),
    );
    return measured(answer.hits, answer);
  }

  /** The documents that best match a text query by BM25, best first, with their `score`. */
  async search(search: IndexSearch): Promise<Measured<Schemas["SearchHit"]>> {
    const params = { path: this.path };
    const answer = unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/search", { params, body: search }),
    );
    return measured(answer.hits, answer);
  }

  /**
   * Named vector and text searches on one snapshot, fused by reciprocal rank:
   * `{searches: {meaning: {vector: ...}, words: {query: "..."}}}`.
   */
  async hybrid(hybrid: IndexHybrid): Promise<Measured<Schemas["FusedHit"]>> {
    const params = { path: this.path };
    const answer = unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/hybrid", { params, body: hybrid }),
    );
    return measured(answer.hits, answer);
  }

  /** The document with `id`. A missing one throws a 404 `SkywakeError`, as a missing branch does. */
  async get(id: DocId): Promise<Document> {
    const params = { path: { ...this.path, id: String(id) } };
    return unwrap(
      await this.client.GET("/indexes/{index}/branches/{branch}/documents/{id}", { params }),
    );
  }

  /** One page of documents by id, number ids first. It reads every segment, so it is for browsing. */
  async documents(page: DocumentCursor = {}): Promise<DocumentPage> {
    const params = { path: this.path, query: page };
    return unwrap(
      await this.client.GET("/indexes/{index}/branches/{branch}/documents", { params }),
    );
  }

  /** Every document, a page at a time. */
  async *allDocuments(): AsyncGenerator<Document, void, undefined> {
    for (let cursor: string | undefined; ;) {
      const page = await this.documents({ limit: BATCH, cursor });
      yield* page.documents;
      if (!page.next) return;
      cursor = page.next;
    }
  }

  /** Forks this branch as `name`, at its head or at an older `version`. Nothing is copied. */
  async fork(name: string, version?: string): Promise<SearchIndex> {
    unwrap(
      await this.client.POST("/indexes/{index}/branches", {
        params: { path: { index: this.name } },
        body: { name, from: this.branch, at: version },
      }),
    );
    return this.at(name);
  }

  /** This branch's versions, newest first: one for every change. */
  async versions(page: { limit?: number; after?: string } = {}): Promise<IndexVersion[]> {
    const params = { path: this.path, query: page };
    return unwrap(await this.client.GET("/indexes/{index}/branches/{branch}/versions", { params }));
  }

  /** Moves this branch back to an older version, as a new version, which it returns. */
  async restore(version: string): Promise<IndexVersion> {
    const params = { path: this.path };
    return unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/restore", {
        params,
        body: { version },
      }),
    );
  }

  /**
   * Starts deleting the data of the whole index that no branch uses, nor any version
   * within its `retention_days`, with an operation `operation(id)` follows.
   */
  async collect(): Promise<Operation> {
    const params = { path: { index: this.name } };
    return unwrap(await this.client.POST("/indexes/{index}/collect", { params }));
  }

  /** This branch's counts, or null while the server cannot count them. */
  async stats(): Promise<Schemas["IndexStats"] | null> {
    const params = { path: this.path };
    const branch = unwrap(await this.client.GET("/indexes/{index}/branches/{branch}", { params }));
    return branch.stats;
  }

  /**
   * Starts clustering this branch's rows. It answers before the build ends,
   * with an operation `operation(id)` follows.
   */
  async build(): Promise<Operation> {
    const params = { path: this.path };
    return unwrap(await this.client.POST("/indexes/{index}/branches/{branch}/build", { params }));
  }

  /**
   * Adds the writes of branch `from` since it forked, or was last merged here, to this
   * branch, and returns how many it added. Where both wrote one document, `from`'s wins.
   */
  async merge(from: string): Promise<number> {
    const params = { path: this.path };
    const answer = await this.client.POST("/indexes/{index}/branches/{branch}/merge", {
      params,
      body: { from },
    });
    return unwrap(answer).rows;
  }

  /** Starts reading this branch into the cache, so the next queries are fast. */
  async warm(): Promise<Operation> {
    const params = { path: this.path };
    return unwrap(await this.client.POST("/indexes/{index}/branches/{branch}/warm", { params }));
  }

  /** A build or warming of this index, and how it went. */
  async operation(id: string): Promise<Operation> {
    const params = { path: { index: this.name, operation: id } };
    return unwrap(await this.client.GET("/indexes/{index}/operations/{operation}", { params }));
  }

  /** How many of the true nearest documents queries find, measured on this branch. */
  async recall(check: Schemas["RecallCheck"] = {}): Promise<Schemas["Recall"]> {
    const params = { path: this.path };
    return unwrap(
      await this.client.POST("/indexes/{index}/branches/{branch}/recall", { params, body: check }),
    );
  }

  /** One page of the index's branches, in name order. */
  async branches(page: Page = {}): Promise<Schemas["IndexBranch"][]> {
    const params = { path: { index: this.name }, query: page };
    return unwrap(await this.client.GET("/indexes/{index}/branches", { params }));
  }

  /** Every branch, a page at a time. */
  allBranches(): AsyncGenerator<Schemas["IndexBranch"], void, undefined> {
    return everything(
      (page) => this.branches(page),
      (branch) => branch.name,
    );
  }

  /** Deletes this branch. `main` stays while the index does. */
  async deleteBranch(): Promise<void> {
    const params = { path: this.path };
    unwrap(await this.client.DELETE("/indexes/{index}/branches/{branch}", { params }));
  }
}

const measured = <T>(list: T[], answer: { performance: Performance; billing: Billing }) =>
  Object.defineProperties(list, {
    performance: { value: answer.performance },
    billing: { value: answer.billing },
  }) as Measured<T>;

/** Sends `items` 1000 to a request, and adds up the counts the requests return. */
async function inBatches<T>(items: T[], send: (batch: T[]) => Promise<number>): Promise<number> {
  let count = 0;
  for (let i = 0; i < items.length; i += BATCH) count += await send(items.slice(i, i + BATCH));
  return count;
}

/** The body of an export of one branch, as it streams in. */
async function exported(
  client: Client,
  branch: { index: string; branch: string },
  query?: { format: "parquet" },
): Promise<ReadableStream<Uint8Array>> {
  const answer = await client.GET("/indexes/{index}/branches/{branch}/export", {
    params: { path: branch, query },
    parseAs: "stream",
  });
  return unwrap(answer) as unknown as ReadableStream<Uint8Array>;
}
