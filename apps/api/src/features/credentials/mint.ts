import { createHash } from "node:crypto";

import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

import type { Config } from "../../config.ts";

export type Access = "read" | "write";

export interface Place {
  bucket: string;
  prefix: string;
  region: string;
}

export function placeOf(location: string, defaultRegion: string): Place | null {
  if (!location.startsWith("s3://")) return null;
  const [path, settings = ""] = location.slice("s3://".length).split("?", 2);
  const at = path!.indexOf("/");
  const bucket = at < 0 ? path! : path!.slice(0, at);
  const prefix = at < 0 ? "" : path!.slice(at + 1).replace(/^\/+|\/+$/g, "");
  const region = new URLSearchParams(settings).get("region") ?? defaultRegion;
  return { bucket, prefix, region };
}

export function policyFor(
  place: Place,
  access: Access,
  protectedBranches: string[] = [],
  ownersHoldRefs = false,
) {
  const objects = `arn:aws:s3:::${place.bucket}/${place.prefix}`;
  const actions = ["s3:GetObject"];
  if (access === "write") actions.push("s3:PutObject", "s3:AbortMultipartUpload");
  const statements: object[] = [
    { Effect: "Allow", Action: actions, Resource: [`${objects}/*`] },
    {
      Effect: "Allow",
      Action: ["s3:ListBucket"],
      Resource: [`arn:aws:s3:::${place.bucket}`],
      Condition: { StringLike: { "s3:prefix": [`${place.prefix}/*`] } },
    },
    { Effect: "Deny", Action: ["s3:PutObject"], Resource: [`${objects}/gc/*`] },
    // The folder's kind keeps garbage collectors off it; only the API writes it.
    { Effect: "Deny", Action: ["s3:PutObject"], Resource: [`${objects}/skywake.json`] },
  ];
  if (access === "write" && ownersHoldRefs) {
    statements.push({ Effect: "Deny", Action: ["s3:PutObject"], Resource: [`${objects}/refs/*`] });
  } else if (access === "write" && protectedBranches.length > 0) {
    // Branch names cannot hold `*` or `?`, so each is an exact key.
    statements.push({
      Effect: "Deny",
      Action: ["s3:PutObject"],
      Resource: protectedBranches.map((name) => `${objects}/refs/${name}`),
    });
  }
  return { Version: "2012-10-17", Statement: statements };
}

/** A customer's role, for a namespace kept in their bucket. */
export interface Role {
  arn: string;
  externalId: string;
}

export interface Minted {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: string;
}

const KEPT = 10_000;

export class Credentials {
  readonly #sts: STSClient;
  readonly #roleArn: string;
  readonly #seconds: number;
  readonly #kept = new Map<string, Promise<Minted>>();

  constructor(
    sts: NonNullable<Config["sts"]>,
    region: string,
    own?: { accessKeyId: string; secretAccessKey: string },
  ) {
    this.#sts = new STSClient({ region, endpoint: sts.endpoint, credentials: own });
    this.#roleArn = sts.roleArn;
    this.#seconds = sts.seconds;
  }

  async mint(
    place: Place,
    access: Access,
    who: string,
    protectedBranches: string[] = [],
    ownersHoldRefs = false,
    role?: Role,
  ): Promise<Minted> {
    const key = JSON.stringify([
      who,
      place,
      access,
      [...protectedBranches].sort(),
      ownersHoldRefs,
      role ?? null,
    ]);
    const kept = this.#kept.get(key);
    if (kept) {
      const minted = await kept.catch(() => null);
      const left = minted ? Date.parse(minted.expiresAt) - Date.now() : 0;
      if (minted && left > (this.#seconds * 1000) / 2) return minted;
      if (this.#kept.get(key) === kept) this.#kept.delete(key);
    }
    if (this.#kept.size >= KEPT) this.#kept.delete(this.#kept.keys().next().value!);
    const minting = this.#fresh(place, access, who, protectedBranches, ownersHoldRefs, role);
    this.#kept.set(key, minting);
    minting.catch(() => this.#kept.get(key) === minting && this.#kept.delete(key));
    return minting;
  }

  async #fresh(
    place: Place,
    access: Access,
    who: string,
    protectedBranches: string[],
    ownersHoldRefs: boolean,
    role: Role | undefined,
  ): Promise<Minted> {
    const answer = await this.#sts.send(
      new AssumeRoleCommand({
        RoleArn: role?.arn ?? this.#roleArn,
        ExternalId: role?.externalId,
        RoleSessionName: sessionName(who),
        DurationSeconds: this.#seconds,
        Policy: JSON.stringify(policyFor(place, access, protectedBranches, ownersHoldRefs)),
      }),
    );
    const minted = answer.Credentials;
    if (!minted?.AccessKeyId || !minted.SecretAccessKey || !minted.SessionToken) {
      throw new Error("STS answered without credentials");
    }
    return {
      accessKeyId: minted.AccessKeyId,
      secretAccessKey: minted.SecretAccessKey,
      sessionToken: minted.SessionToken,
      expiresAt: (minted.Expiration ?? new Date(Date.now() + this.#seconds * 1000)).toISOString(),
    };
  }
}

function sessionName(actor: string) {
  if (actor.startsWith("key:")) return `skywake-key-${actor.slice(4)}`;
  return `skywake-user-${createHash("sha256").update(actor).digest("hex").slice(0, 24)}`;
}
