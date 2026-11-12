import type { Ctx } from "../../http/context.ts";
import type { Feature } from "./catalog.ts";

export async function requires(c: Ctx, org: string, feature: Feature) {
  await c.var.services.billing?.require(org, feature);
}

export async function admitsIndex(c: Ctx, org: string) {
  await c.var.services.billing?.admitIndex(org);
}

export async function admitsFilesystem(c: Ctx, org: string) {
  await c.var.services.billing?.admitFilesystem(org);
}

export async function admitsFiles(c: Ctx, org: string) {
  await c.var.services.billing?.admitFiles(org);
}

export async function admitsDownload(c: Ctx, org: string) {
  await c.var.services.billing?.admit(org, "files_egress");
}

export function downloaded(c: Ctx, org: string, bytes: number) {
  if (bytes > 0) c.var.services.billing?.record(org, "files_egress", BigInt(bytes));
}

export async function filesChanged(c: Ctx, folder: string) {
  await c.var.services.billing?.changed(folder);
}
