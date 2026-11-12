import type { Changes } from "../db/changes.ts";
import type { Db } from "../db/client.ts";
import * as keys from "../features/keys/queries.ts";
import * as orgs from "../features/orgs/queries.ts";
import * as sso from "../features/sso/queries.ts";
import { forbidden, unauthorized } from "../http/errors.ts";
import type { Log } from "../http/log.ts";
import { KEY_PREFIX, keyId, sameKey } from "./keys.ts";
import { Remembered } from "./remembered.ts";
import { roleFrom, type Caller } from "./roles.ts";
import type { ConsoleTokens } from "./tokens.ts";

/** How long a key looked up is kept when no notice of its change arrives. */
const KEY_TTL_MS = 30_000;

type Key = NonNullable<Awaited<ReturnType<typeof keys.find>>>;

export class Authenticator {
  readonly #db: Db;
  readonly #tokens: ConsoleTokens | null;
  readonly #changes: Changes | null;
  readonly #log: Log | undefined;
  readonly #keys = new Remembered<Key | null>(KEY_TTL_MS);

  constructor(db: Db, tokens: ConsoleTokens | null, changes?: Changes, log?: Log) {
    this.#db = db;
    this.#tokens = tokens;
    this.#changes = changes ?? null;
    this.#log = log;
    changes?.on((change) => {
      if (change === null) this.#keys.clear();
      else if (change.table === "keys" && change.id) this.#keys.drop(change.id);
    });
  }

  async caller(token: string | null): Promise<Caller | null> {
    if (token === null) return null;
    const caller = token.startsWith(KEY_PREFIX)
      ? await this.#key(token)
      : await this.#signedIn(token);
    if (!caller) throw unauthorized();
    return caller;
  }

  /**
   * The caller again, read from Postgres, for a request that changes data:
   * a key revoked a moment ago can't write even on a server that missed the notice.
   */
  async recheck(caller: Caller): Promise<void> {
    if (!caller.actor.startsWith("key:")) return;
    const id = caller.actor.slice("key:".length);
    const key = await keys.find(this.#db, id);
    this.#keys.drop(id);
    if (!key || expired(key) || key.org !== caller.org || key.role !== caller.role) {
      throw unauthorized();
    }
  }

  async #key(token: string): Promise<Caller | null> {
    const id = keyId(token);
    if (!id) return null;
    const changes = this.#changes;
    const key = changes
      ? await this.#keys.get(
          id,
          () => keys.find(this.#db, id),
          (found) => found !== null && changes.listening,
        )
      : await keys.find(this.#db, id);
    if (!key || expired(key) || !sameKey(token, key.hash)) return null;
    if (key.lastUsed < Date.now() - keys.TOUCH_MS) {
      key.lastUsed = Date.now();
      void keys
        .touch(this.#db, id)
        .catch((error: unknown) =>
          this.#log?.({ level: "warn", msg: "could not note a key's use", error: String(error) }),
        );
    }
    return {
      org: key.org,
      role: key.role,
      namespaces: key.namespaces,
      actor: `key:${id}`,
      expires: key.expires,
    };
  }

  async #signedIn(token: string): Promise<Caller | null> {
    const claims = this.#tokens && (await this.#tokens.verify(token));
    if (!claims || !(await orgs.exists(this.#db, claims.org))) return null;
    // A token without an email can't show it is outside the domains that
    // must use single sign-on, so it is refused where any must.
    const mustUseSso = claims.email
      ? await sso.required(this.#db, claims.org, claims.email)
      : await sso.anyRequired(this.#db, claims.org);
    if (mustUseSso && claims.sso !== claims.org) {
      throw forbidden("this organization needs you to sign in with single sign-on");
    }
    const memberships = Object.entries(claims.orgs ?? {}).map(([org, role]) => [
      org,
      roleFrom(role),
    ]);
    return {
      org: claims.org,
      role: roleFrom(claims.role),
      namespaces: "*",
      actor: `user:${claims.sub}`,
      expires: null,
      address: claims.ip,
      memberships: Object.fromEntries(memberships),
      ...(claims.email ? { email: claims.email } : {}),
    };
  }
}

export function bearer(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() || null : null;
}

const expired = (key: Key) => key.expires !== null && key.expires.getTime() < Date.now();
