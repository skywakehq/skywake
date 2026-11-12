import type { Ctx } from "../http/context.ts";

export interface Note {
  org?: string;
  owner?: string;
  details?: Record<string, unknown>;
}

export function note(c: Ctx, more: Note) {
  const was = c.get("audit");
  c.set("audit", { ...was, ...more, details: { ...was?.details, ...more.details } });
}
