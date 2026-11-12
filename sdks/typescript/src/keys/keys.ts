import type { Client, Schemas } from "../core/api.js";
import { unwrap } from "../core/errors.js";

export type Role = Schemas["Role"];

export interface NewKeyOptions {
  /** A namespace name, `<folder>/*` for every namespace under a folder, or `*` for all, the default. */
  namespaces?: string;
  /** Whole days, 1 to 3650. Without it, it expires when the key that makes it does, or never. */
  expiresInDays?: number;
}

/** The organization's API keys. Only an admin key may list or revoke them. */
export class Keys {
  constructor(readonly client: Client) {}

  /**
   * Makes a key that can reach only namespaces this client's key can reach.
   * The answer holds the key itself, which is never shown again.
   */
  async create(
    name: string,
    role: Role,
    options: NewKeyOptions = {},
  ): Promise<Schemas["CreatedKey"]> {
    const body = {
      name,
      role,
      namespaces: options.namespaces,
      expires_in_days: options.expiresInDays,
    };
    return unwrap(await this.client.POST("/keys", { body }));
  }

  /** Every key, without the keys themselves. */
  async list(): Promise<Schemas["Key"][]> {
    return unwrap(await this.client.GET("/keys"));
  }

  /** Revokes a key by its id. Requests with it fail from then on. */
  async revoke(id: string): Promise<void> {
    unwrap(await this.client.DELETE("/keys/{id}", { params: { path: { id } } }));
  }
}
