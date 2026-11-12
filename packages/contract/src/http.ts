import { z } from "@hono/zod-openapi";

import { ErrorBody } from "./schemas.ts";

export function json<T extends z.ZodType>(schema: T, description: string) {
  return { content: { "application/json": { schema } }, description };
}

/** A JSON body. A field the schema does not name is refused, not dropped. */
export function body<T extends z.ZodType>(schema: T) {
  return { content: { "application/json": { schema: closed(schema) } }, required: true };
}

/** An object that refuses fields it does not name. */
export function closed<T extends z.ZodType>(schema: T): T {
  // catchall, not strict(), keeps the name given with .openapi().
  return schema instanceof z.ZodObject ? (schema.catchall(z.never()) as unknown as T) : schema;
}

const WHY = {
  400: "The request is not valid.",
  401: "A valid API key or token is needed.",
  402: "The organization's plan does not include this, or its limit is reached.",
  403: "The caller may not do this.",
  404: "It does not exist, or the caller cannot see it.",
  409: "It conflicts with the current state.",
  413: "The request is too large.",
  429: "Too many requests. Wait for `Retry-After` seconds.",
  501: "This server cannot do this.",
  503: "It cannot be done now. Try again later.",
} as const;

export function errors<const C extends keyof typeof WHY>(...codes: C[]) {
  const all = [...codes, 429 as const];
  return Object.fromEntries(all.map((code) => [code, json(ErrorBody, WHY[code])])) as {
    [K in C | 429]: ReturnType<typeof json<typeof ErrorBody>>;
  };
}

export const noContent = { description: "Done." };

type Security = Record<string, string[]>[];

export const signedIn: Security = [{ bearer: [] }];
export const signedInOrPublic: Security = [{ bearer: [] }, {}];

export const orDefault = <T extends z.ZodType>(schema: T, value: z.output<T>) =>
  schema.optional().openapi({ default: value });

export const count = (description: string) =>
  z.coerce.number().int().optional().openapi({ description });

/** The query of a list that comes in pages: pass the last `key` seen as `after`. */
export const page = (what: string, key: string) => ({
  limit: count(`The most ${what} to return, at most 1000. 1000 by default.`),
  after: z
    .string()
    .max(4096)
    .optional()
    .openapi({ description: `The next page: the ${key} of the last one of the page before.` }),
});
