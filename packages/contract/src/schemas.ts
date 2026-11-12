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
    "What a caller may do. `read`: files, history and sessions. `write`: also fork, commit, merge " +
    "and start sessions. `admin`: also keys, namespaces, protected branches and the audit log.",
});
export type Role = z.infer<typeof Role>;

export const Visibility = z.enum(["private", "public"]).openapi("Visibility", {
  description:
    "`private`: only the organization's keys and members. `public`: anyone may also read it, " +
    "without a key, by naming it `<org>:<namespace>`.",
});
export type Visibility = z.infer<typeof Visibility>;

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

export const Name = z
  .string()
  .max(200)
  .regex(NAME, "use parts of letters, digits, `.`, `_` and `-`, split by `/`");

export const NamespacePattern = z
  .string()
  .max(200)
  .refine((text) => text === "*" || NAME.test(text.replace(/\/\*$/, "")), {
    message: "use a namespace name, `<folder>/*` or `*`",
  });

export const Hash = z.string().regex(/^[0-9a-f]{64}$/, "not a commit hash");

export const Time = z.string().openapi({ format: "date-time" });

const namespaceParam = z.string().openapi({
  param: { name: "namespace", in: "path" },
  description:
    "A namespace of your organization, such as `prod/app`, or `<org>:<namespace>` for a public " +
    "namespace of another one. Encode `/` as `%2F`.",
  example: "prod%2Fapp",
});

const branchParam = z.string().openapi({
  param: { name: "branch", in: "path" },
  description: "A branch, such as `main` or `agents/fix-1`. Encode `/` as `%2F`.",
  example: "main",
});

export const NamespaceParams = z.object({ namespace: namespaceParam });
export const BranchParams = z.object({ namespace: namespaceParam, branch: branchParam });
