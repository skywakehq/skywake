import { DEFAULT_ENVIRONMENT, environmentOf, nameIn, qualify } from "@skywake/contract";

import type { Ctx } from "../http/context.ts";
import { requestEnvironment, signedIn } from "../http/request.ts";
import { Failure, missing } from "./errors.ts";
import { type Inner, segment, V1 } from "./forward.ts";
import { closest } from "./suggest.ts";

export type Kind = "disk" | "index";

const LIST = { disk: "/namespaces", index: "/indexes" } as const;

export class Scope {
  readonly c: Ctx;
  readonly v1: V1;
  readonly environment: string;
  readonly org: string;

  constructor(c: Ctx, v1: V1, environment: string, org: string) {
    this.c = c;
    this.v1 = v1;
    this.environment = environment;
    this.org = org;
  }

  full(name: string) {
    return qualify(this.environment, name);
  }

  path(kind: Kind, name: string) {
    return `${LIST[kind]}/${segment(this.full(name))}`;
  }

  mine(full: string): string | null {
    if (environmentOf(full) !== this.environment) return null;
    const name = nameIn(full);
    return name.includes("/") ? null : name;
  }

  async names(kind: Kind): Promise<string[]> {
    const all = await this.v1.get<{ name: string }[]>(LIST[kind]);
    return all.map((each) => this.mine(each.name)).filter((name) => name !== null);
  }

  async exists(kind: Kind, name: string) {
    try {
      await this.v1.get(this.path(kind, name));
      return true;
    } catch (error) {
      if (error instanceof Failure && error.status === 404) return false;
      throw error;
    }
  }

  async notTaken(kind: Kind, name: string) {
    const other: Kind = kind === "disk" ? "index" : "disk";
    if (await this.exists(other, name)) {
      throw new Failure(409, `\`${name}\` is already ${other === "disk" ? "a disk" : "an index"}`, {
        hint: "a disk and an index in one environment can't share a name; pick another",
      });
    }
  }

  async notFound(kind: Kind, name: string): Promise<Failure> {
    const near = closest(name, await this.names(kind).catch(() => []));
    const where = this.environment === DEFAULT_ENVIRONMENT ? "" : ` in \`${this.environment}\``;
    return missing(
      `${kind} \`${name}\`${where}`,
      near
        ? `did you mean \`${near}\`?`
        : `make it by writing to it, or list them: GET /v2/${kind === "disk" ? "disks" : "indexes"}`,
    );
  }
}

export async function scopeOf(c: Ctx, inner: Inner) {
  const caller = await signedIn(c);
  const environment = requestEnvironment(c, caller) ?? DEFAULT_ENVIRONMENT;
  return new Scope(c, new V1(c, inner), environment, caller.org);
}

export async function orMissing<T>(scope: Scope, kind: Kind, name: string, work: Promise<T>) {
  try {
    return await work;
  } catch (error) {
    if (error instanceof Failure && error.status === 404 && !(await scope.exists(kind, name))) {
      throw await scope.notFound(kind, name);
    }
    throw error;
  }
}
