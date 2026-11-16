import type { Schemas } from "../core/api.js";
import { batches } from "../core/batches.js";
import { NotFound } from "../core/errors.js";
import { segment, type Http } from "../core/http.js";
import { collect, pages, type Page } from "../core/paging.js";
import { utf8 } from "../core/bytes.js";
import type {
  AggregateOptions,
  Branch,
  DocId,
  Fields,
  Filter,
  Group,
  Hit,
  IndexInfo,
  IndexSettings,
  NewRow,
  QueryOptions,
  Row,
  Target,
  Upserted,
  Version,
} from "./types.js";

export const MAIN = "main";
const UPSERT = { count: 10_000, bytes: 24 * 1024 * 1024 };
const PAGE = 1000;

const isId = (value: unknown): value is DocId =>
  typeof value === "string" || typeof value === "number";

function targetOf(target: Target): { id?: DocId; ids?: DocId[]; filter?: Filter } {
  if (isId(target)) return { id: target };
  if (Array.isArray(target)) return { ids: target };
  const keys = Object.keys(target);
  if (keys.length === 1 && keys[0] === "filter")
    return { filter: (target as { filter: Filter }).filter };
  return { filter: target };
}

export class Index<R extends Fields = Fields> {
  readonly name: string;
  readonly branch: string;
  readonly #http: Http;

  constructor(http: Http, name: string, branch: string = MAIN) {
    this.#http = http;
    this.name = name;
    this.branch = branch;
  }

  get #path() {
    return `/indexes/${segment(this.name)}`;
  }

  get #on() {
    return { branch: this.branch };
  }

  async upsert(rows: NewRow<R> | NewRow<R>[]): Promise<Upserted> {
    const all = Array.isArray(rows) ? rows : [rows];
    const done: Upserted = { ids: [], count: 0 };
    for (const batch of batches(all, UPSERT, (row) => utf8(JSON.stringify(row)).length)) {
      const { ids, count } = await this.#http.post<Upserted>(`${this.#path}/rows`, batch, this.#on);
      done.ids.push(...ids);
      done.count += count;
    }
    return done;
  }

  async update(target: Target, fields: Partial<R>): Promise<number> {
    const body = { ...targetOf(target), fields };
    return (await this.#http.patch<{ count: number }>(`${this.#path}/rows`, body, this.#on)).count;
  }

  async delete(target: Target): Promise<number> {
    const body = targetOf(target);
    return (await this.#http.post<{ count: number }>(`${this.#path}/rows/delete`, body, this.#on))
      .count;
  }

  async get(id: DocId): Promise<Row<R> | null> {
    try {
      return await this.#http.get<Row<R>>(`${this.#path}/rows/${segment(String(id))}`, this.#on);
    } catch (error) {
      if (error instanceof NotFound && error.path === "id") return null;
      throw error;
    }
  }

  async query(text?: string | QueryOptions, options: QueryOptions = {}): Promise<Hit<R>[]> {
    const asked = typeof text === "string" ? { ...options, text } : { ...text, ...options };
    const page = await this.#http.post<Page<Hit<R>>>(`${this.#path}/query`, {
      ...asked,
      ...this.#on,
    });
    return page.data;
  }

  async count(options: { filter?: Filter } = {}): Promise<number> {
    const body = { filter: options.filter, ...this.#on };
    return (await this.#http.post<{ count: number }>(`${this.#path}/count`, body)).count;
  }

  async aggregate(options: AggregateOptions): Promise<Group[]> {
    const { groupBy, ...rest } = options;
    const body = { ...rest, group_by: groupBy, ...this.#on };
    return (await this.#http.post<Page<Group>>(`${this.#path}/aggregate`, body)).data;
  }

  rows(options: { filter?: Filter } = {}): AsyncGenerator<Row<R>> {
    if (options.filter) return this.#matching(options.filter);
    return pages((cursor) =>
      this.#http.get<Page<Row<R>>>(`${this.#path}/rows`, { ...this.#on, limit: PAGE, cursor }),
    );
  }

  async *#matching(filter: Filter): AsyncGenerator<Row<R>> {
    for (let after: DocId | undefined; ; ) {
      const where = after === undefined ? filter : { and: [filter, { id: { gt: after } }] };
      const hits = await this.query({ filter: where, limit: PAGE });
      for (const { score: _, ...row } of hits) yield row as unknown as Row<R>;
      if (hits.length < PAGE) return;
      after = hits[hits.length - 1]!.id;
    }
  }

  async fork(name: string, options: { at?: string } = {}): Promise<Index<R>> {
    await this.#http.post<Branch>(`${this.#path}/branches`, {
      name,
      from: this.branch,
      ...options,
    });
    return this.on(name);
  }

  on(branch: string): Index<R> {
    return new Index<R>(this.#http, this.name, branch);
  }

  async mergeInto(into: string = MAIN): Promise<{ rows: number }> {
    return this.#http.post(`${this.#path}/merges`, { from: this.branch, into });
  }

  async destroy(): Promise<void> {
    if (this.branch === MAIN) await this.#http.delete(this.#path);
    else await this.#http.delete(`${this.#path}/branches/${segment(this.branch)}`);
  }

  branches(): Promise<Branch[]> {
    return collect(
      pages((cursor) => this.#http.get<Page<Branch>>(`${this.#path}/branches`, { cursor })),
    );
  }

  versions(): Promise<Version[]> {
    return collect(
      pages((cursor) =>
        this.#http.get<Page<Version>>(`${this.#path}/versions`, { ...this.#on, cursor }),
      ),
    );
  }

  restore(to: string | Date): Promise<Version> {
    const version = to instanceof Date ? to.toISOString() : to;
    return this.#http.post(`${this.#path}/restore`, { to: version, ...this.#on });
  }

  async copy(name: string, options: { environment?: string } = {}): Promise<Index<R>> {
    await this.#http.post<Schemas["IndexSummary"]>(`${this.#path}/copy`, { name, ...options });
    const http = options.environment ? this.#http.in(options.environment) : this.#http;
    return new Index<R>(http, name);
  }

  info(): Promise<IndexInfo> {
    return this.#http.get(this.#path);
  }

  configure(settings: IndexSettings): Promise<IndexInfo> {
    return this.#http.patch(this.#path, {
      read_only: settings.readOnly,
      retention_days: settings.retentionDays,
      pinned: settings.pinned,
      attributes: settings.attributes,
      drop_attributes: settings.dropAttributes,
    });
  }
}
