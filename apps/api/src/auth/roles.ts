import type { Role } from "@skywake/contract";

import { forbidden } from "../http/errors.ts";

export interface Caller {
  org: string;
  role: Role;
  namespaces: string;
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

/**
 * Whether a key's pattern reaches `name`: `*` reaches every namespace, `prod/*`
 * those under `prod/`, and anything else only itself.
 */
export function matches(pattern: string, name: string) {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

export const mayUse = (caller: Caller, namespace: string) => matches(caller.namespaces, namespace);

/** Keys and the audit log belong to the whole organization. */
export function allowOrgAdmin(caller: Caller) {
  allow(caller, "admin");
  if (caller.namespaces !== "*") throw forbidden("this needs an admin key for every namespace");
}

export function allow(caller: Caller, role: Role, namespace?: string) {
  if (!atLeast(caller.role, role)) throw forbidden(`this needs the \`${role}\` role`);
  if (namespace !== undefined && !mayUse(caller, namespace)) {
    throw forbidden(`no access to \`${namespace}\``);
  }
}
