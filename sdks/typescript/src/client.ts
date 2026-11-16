import createClient from "openapi-fetch";

import type { Client, Schemas } from "./core/api.js";
import { unwrap } from "./core/errors.js";
import { retryingFetch, type RetryOptions } from "./core/retry.js";
import { resolveSettings, type Asked } from "./core/settings.js";
import { Namespace } from "./filesystem/namespace.js";
import type { paths } from "./generated/schema.js";
import { Indexes } from "./indexes/indexes.js";
import { SearchIndex } from "./indexes/search-index.js";
import { Keys } from "./keys/keys.js";

export interface Options extends RetryOptions, Asked {
  fetch?: typeof fetch;
}

export class Skywake {
  readonly client: Client;
  readonly indexes: Indexes;
  readonly keys: Keys;
  readonly url: string;
  readonly environment: string | undefined;

  constructor(options: Options = {}) {
    const { key, url, environment } = resolveSettings(options);
    this.url = url.replace(/\/+$/, "").replace(/\/v1$/, "");
    this.environment = environment;
    this.client = createClient<paths>({
      baseUrl: `${this.url}/v1`,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(environment ? { "Skywake-Environment": environment } : {}),
      },
      fetch: retryingFetch(options, options.fetch),
    });
    this.indexes = new Indexes(this.client);
    this.keys = new Keys(this.client);
  }

  async whoami(): Promise<Schemas["Whoami"]> {
    return unwrap(await this.client.GET("/whoami"));
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
