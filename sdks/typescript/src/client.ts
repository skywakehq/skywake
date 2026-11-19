import type { Schemas } from "./core/api.js";
import { Http, segment } from "./core/http.js";
import { pages, type Page } from "./core/paging.js";
import { retryingFetch, type RetryOptions } from "./core/retry.js";
import { resolveSettings, type Asked } from "./core/settings.js";
import { Index, MAIN } from "./indexes/index-handle.js";
import type { Fields, IndexSummary, NewIndexOptions, RowsOf } from "./indexes/types.js";

export interface Options extends RetryOptions, Asked {
  fetch?: typeof fetch;
}

export type Role = Schemas["Role"];
export type Key = Schemas["KeyV2"];
export type CreatedKey = Schemas["CreatedKey"];
export type Environment = Schemas["Environment"];
export type Whoami = Schemas["Whoami"];

export interface NewKey {
  name: string;
  role: Role;
  environment?: string | null;
  only?: string[];
  expiresInDays?: number;
}

export class Skywake {
  readonly url: string;
  readonly environment: string | undefined;
  readonly #http: Http;

  constructor(options: Options = {}) {
    const { key, url, environment } = resolveSettings(options);
    this.url = url.replace(/\/+$/, "").replace(/\/v[12]$/, "");
    this.environment = environment;
    this.#http = new Http(
      `${this.url}/v2`,
      {
        authorization: `Bearer ${key}`,
        ...(environment ? { "skywake-environment": environment } : {}),
      },
      retryingFetch(options, options.fetch),
    );
  }

  index<N extends string, R extends Fields = RowsOf<N>>(
    name: N,
    options: { branch?: string } = {},
  ): Index<R> {
    return new Index<R>(this.#http, name, options.branch ?? MAIN);
  }

  async createIndex<R extends Fields = Fields>(
    name: string,
    options: NewIndexOptions = {},
  ): Promise<Index<R>> {
    await this.#http.post("/indexes", { name, ...options });
    return new Index<R>(this.#http, name, MAIN);
  }

  listIndexes(): AsyncGenerator<IndexSummary> {
    return this.#list<IndexSummary>("/indexes");
  }

  createKey(key: NewKey): Promise<CreatedKey> {
    const { expiresInDays, ...rest } = key;
    return this.#http.post("/keys", { ...rest, expires_in_days: expiresInDays });
  }

  listKeys(): AsyncGenerator<Key> {
    return this.#list<Key>("/keys");
  }

  async revokeKey(id: string): Promise<void> {
    await this.#http.delete(`/keys/${segment(id)}`);
  }

  listEnvironments(): AsyncGenerator<Environment> {
    return this.#list<Environment>("/environments");
  }

  createEnvironment(name: string): Promise<Environment> {
    return this.#http.post("/environments", { name });
  }

  whoami(): Promise<Whoami> {
    return this.#http.get("/whoami");
  }

  #list<T>(path: string): AsyncGenerator<T> {
    return pages((cursor) => this.#http.get<Page<T>>(path, { cursor }));
  }
}
