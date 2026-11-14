// Buckets customers bring. An environment with a store keeps every namespace and
// index made in it there, under the region `bucket:<org>/<environment>`, so the
// code that opens stores by region needs no other change. The API signs for the
// bucket with a role the customer lets it assume, or with keys it keeps sealed.

import { randomBytes } from "node:crypto";

import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { Engine, Index, renewStoreKeys, type StoreKeys } from "@skywake/engine";
import { and, eq } from "drizzle-orm";

import type { Config } from "../../config.ts";
import type { Db } from "../../db/client.ts";
import { environments, type StoreAccess } from "../../db/schema.ts";
import { type OwnStore, inFolder } from "../../engine/stores.ts";
import type { Log } from "../../http/log.ts";
import { unseal } from "../../security/sealed.ts";

const PREFIX = "bucket:";
// Renew assumed-role keys when this much of their life is gone.
const RENEW_AT = 0.8;
const ROLE_SECONDS = 3600;

export function bucketRegion(org: string, environment: string) {
  return `${PREFIX}${org}/${environment}`;
}

export function isBucketRegion(region: string) {
  return region.startsWith(PREFIX);
}

function parse(region: string) {
  if (!isBucketRegion(region)) return null;
  const rest = region.slice(PREFIX.length);
  const at = rest.indexOf("/");
  if (at < 1) return null;
  return { org: rest.slice(0, at), environment: rest.slice(at + 1) };
}

/** Where in a customer's bucket a namespace or index goes: the bucket is theirs, so no org folder. */
export function bucketFolder(kind: "fs" | "ix", id: string) {
  return `${kind}/${id}`;
}

/** The sealing context of an environment's keys: a sealed secret only opens for its own row. */
export function keysContext(org: string, environment: string) {
  return `environment-store:${org}/${environment}`;
}

/** What `?region=` in an `s3://` store names, or a default. */
export function regionIn(store: string, fallback: string) {
  const at = store.indexOf("?");
  if (at < 0) return fallback;
  return new URLSearchParams(store.slice(at + 1)).get("region") ?? fallback;
}

export class Buckets {
  readonly #db: Db;
  readonly #config: Config;
  readonly #log: Log;
  readonly #renewals = new Map<string, NodeJS.Timeout>();

  constructor(db: Db, config: Config, log: Log) {
    this.#db = db;
    this.#config = config;
    this.#log = log;
  }

  /** The store behind a `bucket:` region, with keys that stay fresh while the server runs. */
  find = async (region: string): Promise<OwnStore | null> => {
    const place = parse(region);
    if (!place) return null;
    const [row] = await this.#db
      .select()
      .from(environments)
      .where(and(eq(environments.org, place.org), eq(environments.name, place.environment)));
    if (!row?.store || !row.storeAccess) return null;
    const keys = await this.keys(region, row.storeAccess, place.org, place.environment);
    return { store: row.store, keys };
  };

  /** Keys for this access, under the id `region`. A role's keys renew themselves. */
  async keys(
    id: string,
    access: StoreAccess,
    org: string,
    environment: string,
  ): Promise<StoreKeys> {
    if (access.type === "keys") {
      const secretKey = this.#config.secretKey;
      if (!secretKey) throw new Error("SKYWAKE_API_SECRET_KEY is needed to open this bucket");
      return {
        id,
        accessKeyId: access.accessKeyId,
        secretAccessKey: unseal(secretKey, access.secret, keysContext(org, environment)),
        endpoint: access.endpoint,
        region: access.region,
      };
    }
    const assumed = await this.#assume(id, access);
    this.#renew(id, access, assumed.life);
    return assumed.keys;
  }

  /** Stops renewing a region's keys, when its environment drops the bucket. */
  stop(id: string) {
    clearTimeout(this.#renewals.get(id));
    this.#renewals.delete(id);
  }

  close() {
    for (const timer of this.#renewals.values()) clearTimeout(timer);
    this.#renewals.clear();
  }

  async #assume(id: string, access: Extract<StoreAccess, { type: "aws_role" }>) {
    const sts = new STSClient({
      region: access.region,
      endpoint: this.#config.sts?.endpoint,
    });
    const answer = await sts.send(
      new AssumeRoleCommand({
        RoleArn: access.roleArn,
        RoleSessionName: `skywake-${randomBytes(6).toString("hex")}`,
        ExternalId: access.externalId,
        DurationSeconds: ROLE_SECONDS,
      }),
    );
    const got = answer.Credentials;
    if (!got?.AccessKeyId || !got.SecretAccessKey || !got.Expiration) {
      throw new Error("the role gave no keys");
    }
    const keys: StoreKeys = {
      id,
      accessKeyId: got.AccessKeyId,
      secretAccessKey: got.SecretAccessKey,
      sessionToken: got.SessionToken,
      region: access.region,
    };
    return { keys, life: Math.max(60_000, got.Expiration.getTime() - Date.now()) };
  }

  #renew(id: string, access: Extract<StoreAccess, { type: "aws_role" }>, life: number) {
    this.stop(id);
    const timer = setTimeout(async () => {
      try {
        const assumed = await this.#assume(id, access);
        renewStoreKeys(assumed.keys);
        this.#renew(id, access, assumed.life);
      } catch (error) {
        // Keep the old keys; try again in a minute, well before they run out.
        this.#log({ level: "warn", msg: "bucket keys not renewed", region: id, error: String(error) });
        this.#renew(id, access, 75_000);
      }
    }, life * RENEW_AT);
    timer.unref();
    this.#renewals.set(id, timer);
  }
}

/**
 * Proves the API can use a bucket before anything is kept there: it must take
 * conditional writes (the store's first branch checks), and let the API list and
 * delete. Everything written goes in a throwaway folder that is removed after.
 */
export async function verifyBucket(store: string, keys: StoreKeys) {
  const folder = `.skywake-check/${randomBytes(8).toString("hex")}`;
  const location = inFolder(store, folder);
  const engine = Engine.open(location, { keys });
  try {
    await engine.createBranch("check");
    const branches = await engine.branches();
    if (!branches.includes("check")) throw new Error("a branch written could not be listed");
  } finally {
    await Index.open(location, { keys })
      .destroy()
      .catch(() => {});
  }
}
