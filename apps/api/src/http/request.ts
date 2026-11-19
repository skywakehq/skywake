import type { Role } from "@skywake/contract";

import { bearer } from "../auth/authenticate.ts";
import type { Caller } from "../auth/roles.ts";
import type { Ctx } from "./context.ts";
import { badRequest, forbidden, HttpError, unauthorized } from "./errors.ts";
import { clientAddress } from "./rate-limit.ts";

export async function signedIn(c: Ctx): Promise<Caller> {
  const caller = await c.var.caller();
  if (!caller) throw unauthorized();
  return caller;
}

export const ENVIRONMENT_HEADER = "skywake-environment";

export function requestEnvironment(c: Ctx, caller: Caller): string | null {
  const asked = c.req.header(ENVIRONMENT_HEADER)?.trim() || null;
  if (asked === null) return caller.environment;
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/.test(asked)) {
    throw badRequest(`\`${asked}\` is not an environment name`);
  }
  if (caller.environment !== null && caller.environment !== asked) {
    throw forbidden(`this key works in \`${caller.environment}\`, not \`${asked}\``);
  }
  return asked;
}

/** Only the operator's admin token passes. */
export function operator(c: Ctx) {
  if (!c.var.services.admin.matches(bearer(c.req.header("authorization")))) {
    throw new HttpError(401, "the admin token is needed");
  }
}

/** Where the caller calls from: for the console's people, where the console saw them. */
export const addressOf = (c: Ctx, caller: Caller) =>
  caller.address ?? clientAddress(c, c.var.services.config.trustProxy);

/** An index the caller may use with `role`. */
export async function indexFor(c: Ctx, name: string, role: Role) {
  const caller = await signedIn(c);
  const index = await c.var.services.access.index(caller, name, role);
  return { caller, index };
}
