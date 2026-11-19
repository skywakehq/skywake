import { z } from "@hono/zod-openapi";

export { z };

export const ErrorCode = z
  .enum([
    "invalid",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "too_large",
    "rate_limited",
    "internal",
    "not_implemented",
    "unavailable",
    "method_not_allowed",
    "unsupported_media_type",
    "ip_not_allowed",
    "payment_required",
  ])
  .openapi("ErrorCode", { description: "What kind of error it is, for programs to check." });
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorFields = {
  error: z.string().openapi({ description: "What went wrong, for people to read." }),
  code: ErrorCode,
  request_id: z.string().nullable().openapi({
    description: "The request's id, also in the `X-Request-Id` header. Quote it in bug reports.",
  }),
};

export const ErrorBody = z
  .object({
    ...ErrorFields,
    path: z.string().optional().openapi({
      description: "For an invalid request, the JSON path of the field that is wrong.",
      example: "filter.and[1].price.lt",
    }),
  })
  .openapi("ErrorBody", { description: "The body of every error response." });

export const Role = z.enum(["read", "write", "admin"]).openapi("Role", {
  description:
    "What a caller may do. `read`: query and read rows. `write`: also write rows, fork and merge " +
    "branches. `admin`: also keys, indexes and the audit log.",
});
export type Role = z.infer<typeof Role>;

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

export const Name = z
  .string()
  .max(200)
  .regex(NAME, "use parts of letters, digits, `.`, `_` and `-`, split by `/`");

export const NamespacePattern = z
  .string()
  .max(200)
  .refine((text) => text === "*" || NAME.test(text.replace(/\/\*$/, "")), {
    message: "use an index name, `<folder>/*` or `*`",
  });

export const EnvironmentName = z
  .string()
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/, "use letters, digits, `.`, `_` and `-`")
  .openapi({ example: "prod" });

export const NamePattern = z
  .string()
  .max(200)
  .refine((text) => text === "*" || NAME.test(text.replace(/\*$/, "").replace(/[-_./]$/, "a")), {
    message: "use a name, a prefix ending in `*` such as `docs-*`, or `*`",
  })
  .openapi({ example: "docs-*" });

export const Time = z.string().openapi({ format: "date-time" });
