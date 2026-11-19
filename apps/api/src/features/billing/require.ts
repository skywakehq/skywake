import type { Ctx } from "../../http/context.ts";
import type { Feature } from "./catalog.ts";

export async function requires(c: Ctx, org: string, feature: Feature) {
  await c.var.services.billing?.require(org, feature);
}

export async function admitsIndex(c: Ctx, org: string) {
  await c.var.services.billing?.admitIndex(org);
}
