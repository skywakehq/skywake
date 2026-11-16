import { environmentOf, globCovers, globMatches, nameIn, type Role } from "@skywake/contract";

import { forbidden } from "../http/errors.ts";

export interface Caller {
  org: string;
  role: Role;
  /** The environment the caller works in; null when it may use every one. */
  environment: string | null;
  /** Names or prefixes ending in `*` it reaches within its environment. */
  only: string[];
  actor: string;
  /** When the caller's key expires; null for a key that never does, or a console token. */
  expires: Date | null;
  /** For a console token: where the person calls from, as the console saw it. */
  address?: string;
  /** For a console token: the person's roles in their other organizations. */
  memberships?: Record<string, Role>;
  /** For a console token: the person's email, when the console knows it. */
  email?: string;
}

const RANK: Record<Role, number> = { read: 0, write: 1, admin: 2 };

export const atLeast = (role: Role, needed: Role) => RANK[role] >= RANK[needed];

export function roleFrom(text: string): Role {
  if (text === "admin" || text === "owner") return "admin";
  if (text === "write" || text === "member") return "write";
  return "read";
}

export const everyEnvironment = (caller: Caller) => caller.environment === null;

export const mayUseEnvironment = (caller: Caller, environment: string) =>
  caller.environment === null || caller.environment === environment;

export function mayUse(caller: Caller, name: string) {
  if (!mayUseEnvironment(caller, environmentOf(name))) return false;
  const local = nameIn(name);
  return caller.only.some((pattern) => globMatches(pattern, local));
}

export function covers(caller: Caller, only: string[]) {
  return only.every((inner) => caller.only.some((outer) => globCovers(outer, inner)));
}

export const isOrgAdmin = (caller: Caller) =>
  atLeast(caller.role, "admin") && everyEnvironment(caller) && caller.only.includes("*");

export function allowOrgAdmin(caller: Caller) {
  allow(caller, "admin");
  if (!everyEnvironment(caller) || !caller.only.includes("*")) {
    throw forbidden("this needs an admin key for every environment");
  }
}

export function allowEnvironment(caller: Caller, role: Role, environment: string) {
  allow(caller, role);
  if (!mayUseEnvironment(caller, environment)) {
    throw forbidden(`this key works in \`${caller.environment}\`, not \`${environment}\``);
  }
}

export function allow(caller: Caller, role: Role, name?: string) {
  if (!atLeast(caller.role, role)) throw forbidden(`this needs the \`${role}\` role`);
  if (name === undefined) return;
  const environment = environmentOf(name);
  if (!mayUseEnvironment(caller, environment)) {
    throw forbidden(
      `this key works in \`${caller.environment}\`; \`${name}\` is in \`${environment}\``,
    );
  }
  if (!mayUse(caller, name)) throw forbidden(`no access to \`${name}\``);
}
