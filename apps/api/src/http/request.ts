import type { Role } from "@skywake/contract";

import { note } from "../audit/note.ts";
import type { Namespace } from "../auth/access.ts";
import { bearer } from "../auth/authenticate.ts";
import type { Caller } from "../auth/roles.ts";
import type { Ctx } from "./context.ts";
import { HttpError, unauthorized } from "./errors.ts";
import { clientAddress } from "./rate-limit.ts";

export async function signedIn(c: Ctx): Promise<Caller> {
  const caller = await c.var.caller();
  if (!caller) throw unauthorized();
  return caller;
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

export async function readable(c: Ctx, ref: string): Promise<Namespace> {
  const ns = await c.var.services.access.namespace(await c.var.caller(), ref, "read");
  // A public namespace's owners see who else used it in their audit log.
  note(c, { owner: ns.org });
  return ns;
}

export async function changeable(c: Ctx, ref: string, role: Role) {
  const caller = await signedIn(c);
  const ns = await c.var.services.access.namespace(caller, ref, role);
  note(c, { owner: ns.org });
  return { caller, ns };
}

/** An index the caller may use with `role`. */
export async function indexFor(c: Ctx, name: string, role: Role) {
  const caller = await signedIn(c);
  const index = await c.var.services.access.index(caller, name, role);
  return { caller, index };
}
