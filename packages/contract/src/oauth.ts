import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, signedIn } from "./http.ts";
import { EnvironmentName, Role, Time, z } from "./schemas.ts";

/** The one client that signs in this way: Skywake for Mac. */
export const DESKTOP_CLIENT = "skywake-desktop";

/**
 * Where the desktop app waits for its code: a port on this computer's loopback
 * address, as RFC 8252 asks of native apps. Any port, one path.
 */
export const DESKTOP_REDIRECT = /^http:\/\/127\.0\.0\.1:(\d{2,5})\/callback$/;

const ClientId = z.literal(DESKTOP_CLIENT);

const RedirectUri = z
  .string()
  .regex(DESKTOP_REDIRECT, "the redirect must be http://127.0.0.1:PORT/callback");

// 43 to 128 characters of the unreserved set, as RFC 7636 asks.
const Verifier = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);

export const NewCode = z
  .object({
    client_id: ClientId,
    redirect_uri: RedirectUri,
    code_challenge: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .openapi({ description: "BASE64URL(SHA-256(code_verifier)), without padding." }),
    code_challenge_method: z.literal("S256"),
    device: z.string().min(1).max(64),
    environment: EnvironmentName.nullable().openapi({
      description:
        "The environment the app works in. Null for every one: organization admins only.",
    }),
    role: Role,
  })
  .openapi("NewOAuthCode");

export const IssuedCode = z.object({ code: z.string(), expires: Time }).openapi("IssuedOAuthCode");

export const TokenRequest = z
  .discriminatedUnion("grant_type", [
    z.object({
      grant_type: z.literal("authorization_code"),
      client_id: ClientId,
      code: z.string().min(1).max(200),
      code_verifier: Verifier,
      redirect_uri: RedirectUri,
    }),
    z.object({
      grant_type: z.literal("refresh_token"),
      client_id: ClientId,
      refresh_token: z.string().min(1).max(200),
    }),
  ])
  .openapi("OAuthTokenRequest");

export const Organization = z.object({ id: z.string(), name: z.string() });

export const Tokens = z
  .object({
    access_token: z
      .string()
      .openapi({ description: "An API key that works for `expires_in` seconds." }),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int(),
    refresh_token: z
      .string()
      .openapi({ description: "Makes the next pair, once. Using it twice ends the sign-in." }),
    organization: Organization,
    organizations: z.array(Organization).openapi({
      description: "Every organization of the person, to switch to by signing in again.",
    }),
    environment: z.string().nullable(),
    role: Role,
    email: z.string().nullable(),
  })
  .openapi("OAuthTokens");

export const Revocation = z
  .object({ client_id: ClientId, token: z.string().min(1).max(200) })
  .openapi("OAuthRevocation");

export const createCode = createRoute({
  method: "post",
  path: "/oauth/codes",
  operationId: "createOAuthCode",
  tags: ["keys"],
  summary:
    "Approves a desktop app's sign-in for the person in the console: a code, good once for a minute, that only the app's PKCE verifier redeems.",
  security: signedIn,
  request: { body: body(NewCode) },
  responses: { 201: json(IssuedCode, "The code."), ...errors(400, 401, 403) },
});

export const token = createRoute({
  method: "post",
  path: "/oauth/token",
  operationId: "oauthToken",
  tags: ["keys"],
  security: [],
  summary: "Redeems a code with its verifier, or a refresh token, for a new pair of tokens.",
  request: { body: body(TokenRequest) },
  responses: { 200: json(Tokens, "The tokens."), ...errors(400) },
});

export const revoke = createRoute({
  method: "post",
  path: "/oauth/revoke",
  operationId: "oauthRevoke",
  tags: ["keys"],
  security: [],
  summary:
    "Ends a desktop app's sign-in, given its refresh or access token. Unknown tokens are no error.",
  request: { body: body(Revocation) },
  responses: { 204: { description: "Ended, or never known." }, ...errors(400) },
});
