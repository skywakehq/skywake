import { z } from "@hono/zod-openapi";

import { ErrorCode } from "../schemas.ts";

export const ShortName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/, "use letters, digits, `.`, `_` and `-`, with no `/`");

export const BranchName = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/,
    "use parts of letters, digits, `.`, `_` and `-`, split by `/`",
  );

export const V2Error = z
  .object({
    error: z.object({
      code: ErrorCode,
      message: z.string().openapi({ description: "What went wrong, for people to read." }),
      hint: z
        .string()
        .nullable()
        .openapi({ description: "How to fix it, when there is a likely fix." }),
      request_id: z.string().nullable(),
      path: z
        .string()
        .optional()
        .openapi({ description: "For bad input, the JSON path of the field that is wrong." }),
      conflicts: z
        .array(z.string())
        .optional()
        .openapi({ description: "For a merge that could not finish, what conflicts." }),
    }),
  })
  .openapi("Error");

const WHY = {
  400: "The request is not valid; `hint` names the field.",
  401: "No key, or the key is wrong or expired.",
  402: "The organization's plan does not include this, or its limit is reached.",
  403: "The key's role or environment does not allow this.",
  404: "It does not exist; `hint` suggests the closest name.",
  409: "It conflicts with the current state.",
  413: "The request is too large.",
  429: "Too many requests. Wait for `Retry-After` seconds.",
  503: "It cannot be done now. Try again later.",
} as const;

export function json<T extends z.ZodType>(schema: T, description: string) {
  return { content: { "application/json": { schema } }, description };
}

export function body<T extends z.ZodType>(schema: T) {
  return { content: { "application/json": { schema } }, required: true };
}

export const bytes = {
  content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
  required: true,
};

export function errors<const C extends keyof typeof WHY>(...codes: C[]) {
  const all = [...codes, 401 as const, 429 as const];
  return Object.fromEntries(all.map((code) => [code, json(V2Error, WHY[code])])) as {
    [K in C | 401 | 429]: ReturnType<typeof json<typeof V2Error>>;
  };
}

export const done = { description: "Done." };

export const security = [{ bearer: [] }];

export function listOf<T extends z.ZodType>(item: T, name: string) {
  return z
    .object({
      data: z.array(item),
      next: z
        .string()
        .nullable()
        .openapi({ description: "Pass as `cursor` for the next page. Null on the last page." }),
    })
    .openapi(name);
}

export const PageQuery = {
  limit: z.coerce.number().int().min(1).max(1000).optional().openapi({
    description: "The most items to return, at most 1000. 100 by default.",
  }),
  cursor: z
    .string()
    .max(4096)
    .optional()
    .openapi({ description: "The `next` of the page before." }),
};

export const BranchQuery = {
  branch: BranchName.optional().openapi({ description: "`main` by default." }),
};

export const Time = z.string().openapi({ format: "date-time" });

const nameParam = (name: string, example: string) =>
  ShortName.openapi({ param: { name, in: "path" }, example });

export const IndexParams = z.object({ index: nameParam("index", "products") });

export const Branch = z
  .object({
    name: z.string(),
    from: z.string().nullable().openapi({ description: "The branch it was forked from." }),
    created: Time,
  })
  .openapi("Branch");

export const NewBranch = z
  .object({
    name: BranchName.openapi({ example: "agent-1" }),
    from: BranchName.optional().openapi({ description: "The branch to fork. `main` by default." }),
    at: z.string().min(1).max(100).optional().openapi({
      description: "Fork this version of `from` instead of its newest.",
    }),
  })
  .openapi("NewBranch");

export const Merge = z
  .object({
    from: BranchName,
    into: BranchName.optional().openapi({ description: "`main` by default." }),
  })
  .openapi("Merge");
