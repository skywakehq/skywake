import createClient from "openapi-fetch";

import type { Client, Schemas } from "./core/api.js";
import { unwrap } from "./core/errors.js";
import { retryingFetch, type RetryOptions } from "./core/retry.js";
import { Namespace } from "./filesystem/namespace.js";
import type { paths } from "./generated/schema.js";
import { Indexes } from "./indexes/indexes.js";
import { SearchIndex } from "./indexes/search-index.js";
import { Keys } from "./keys/keys.js";

export interface Options extends RetryOptions {
  /** Where the API listens, such as `https://api.skywake.dev`. */
  url: string;
  /** An API key (`sw_...`) or a console token. */
  key: string;
  /** Sends requests. `globalThis.fetch` by default. */
  fetch?: typeof fetch;
}

export class Skywake {
  readonly client: Client;
  /** Make, list, read and delete search indexes. */
  readonly indexes: Indexes;
  /** Make, list and revoke the organization's API keys. */
  readonly keys: Keys;

  constructor(options: Options) {
    this.client = createClient<paths>({
      // Every route lives under /v1.
      baseUrl: `${options.url.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`,
      headers: { Authorization: `Bearer ${options.key}` },
      fetch: retryingFetch(options, options.fetch),
    });
    this.indexes = new Indexes(this.client);
    this.keys = new Keys(this.client);
  }

  /** A search index, on its `main` branch. */
  index(name: string): SearchIndex {
    return new SearchIndex(this.client, name);
  }

  namespace(name: string): Namespace {
    return new Namespace(this.client, name);
  }

  async namespaces(): Promise<Schemas["Namespace"][]> {
    return unwrap(await this.client.GET("/namespaces"));
  }

  async createNamespace(name: string, region?: string): Promise<Namespace> {
    unwrap(await this.client.POST("/namespaces", { body: { name, region } }));
    return this.namespace(name);
  }

  /**
   * Makes an organization and its first admin key, which the answer holds once.
   * Only the server's operator token may: pass it as `key`.
   */
  async createOrg(name: string): Promise<Schemas["CreatedOrg"]> {
    return unwrap(await this.client.POST("/orgs", { body: { name } }));
  }

  async regions(): Promise<Schemas["Region"][]> {
    return unwrap(await this.client.GET("/regions"));
  }

  async environments(): Promise<Schemas["Environment"][]> {
    return unwrap(await this.client.GET("/environments"));
  }

  /** An environment has no region; each namespace picks its own. */
  async createEnvironment(name: string): Promise<Schemas["Environment"]> {
    return unwrap(await this.client.POST("/environments", { body: { name } }));
  }
}
