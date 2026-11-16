import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, signedIn } from "./http.ts";
import { EnvironmentName, Role, Time, z } from "./schemas.ts";

export const LoginCode = z
  .string()
  .regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/i, "a code looks like `ABCD-2345`")
  .openapi({ param: { name: "code", in: "path" }, example: "ABCD-2345" });

export const NewLogin = z
  .object({
    key_id: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .openapi({ description: "The id part of the key the CLI made." }),
    key_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .openapi({ description: "The BLAKE3 hash of the whole key, in hex. The key stays local." }),
    device: z
      .string()
      .min(1)
      .max(64)
      .openapi({ description: "The machine signing in, shown to the person who approves it." }),
  })
  .openapi("NewLogin");

export const StartedLogin = z
  .object({
    code: z.string().openapi({ description: "The code to check in the browser." }),
    url: z.string().nullable().openapi({
      description: "Where to approve it. Null when the server does not know the console's address.",
    }),
    expires: Time,
  })
  .openapi("StartedLogin");

export const Login = z
  .object({
    code: z.string(),
    device: z.string(),
    expires: Time,
    role: Role.openapi({ description: "The most the person approving may give the key." }),
    every_environment: z
      .boolean()
      .openapi({ description: "Whether the person may give a key for every environment." }),
  })
  .openapi("Login");

export const Approval = z
  .object({
    environment: EnvironmentName.nullable().openapi({
      description:
        "The environment the key works in. Null for every one: organization admins only.",
    }),
    role: Role,
  })
  .openapi("Approval");

export const ApprovedLogin = z
  .object({ id: z.string(), name: z.string(), role: Role, environment: z.string().nullable() })
  .openapi("ApprovedLogin");

const code = z.object({ code: LoginCode });

export const getLogin = createRoute({
  method: "get",
  path: "/logins/{code}",
  operationId: "getLogin",
  tags: ["keys"],
  summary: "A sign-in the CLI started, for the person approving it.",
  security: signedIn,
  request: { params: code },
  responses: { 200: json(Login, "The sign-in."), ...errors(401, 404) },
});

export const approveLogin = createRoute({
  method: "post",
  path: "/logins/{code}",
  operationId: "approveLogin",
  tags: ["keys"],
  summary: "Approves a sign-in the CLI started: its key starts to work, with this scope.",
  security: signedIn,
  request: { params: code, body: body(Approval) },
  responses: { 200: json(ApprovedLogin, "The key."), ...errors(400, 401, 403, 404) },
});
