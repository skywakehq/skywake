import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, signedIn } from "./http.ts";
import { z } from "./schemas.ts";

export const Domain = z
  .string()
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
  .openapi({ example: "example.com" });

export const SsoPolicy = z
  .object({
    required_domains: z
      .array(Domain)
      .max(100)
      .openapi({
        description:
          "People with an email at these domains must sign in through the organization's single " +
          "sign-on. Console tokens of theirs that did not come from it are refused.",
      }),
  })
  .openapi("SsoPolicy");

const OrgParam = z.object({
  org: z.string().openapi({ param: { name: "org", in: "path" } }),
});

export const getSsoPolicy = createRoute({
  method: "get",
  path: "/orgs/{org}/sso",
  operationId: "getSsoPolicy",
  tags: ["orgs"],
  summary: "Which email domains must sign in through single sign-on. Needs the admin token.",
  security: signedIn,
  request: { params: OrgParam },
  responses: { 200: json(SsoPolicy, "The policy."), ...errors(401, 404) },
});

export const setSsoPolicy = createRoute({
  method: "put",
  path: "/orgs/{org}/sso",
  operationId: "setSsoPolicy",
  tags: ["orgs"],
  summary:
    "Sets which email domains must sign in through single sign-on. Needs the admin token: the " +
    "console checks each domain is verified first.",
  security: signedIn,
  request: { params: OrgParam, body: body(SsoPolicy) },
  responses: { 200: json(SsoPolicy, "The new policy."), ...errors(400, 401, 404) },
});

export const SsoDomainOrgs = z
  .object({
    orgs: z.array(z.string()).openapi({
      description: "The organizations whose people at this domain must use single sign-on.",
    }),
  })
  .openapi("SsoDomainOrgs");

export const ssoDomainOrgs = createRoute({
  method: "get",
  path: "/sso/domains/{domain}",
  operationId: "ssoDomainOrgs",
  tags: ["orgs"],
  summary:
    "Which organizations require single sign-on for an email domain. Needs the admin token: " +
    "the console asks before it lets anyone sign in another way.",
  security: signedIn,
  request: {
    params: z.object({ domain: z.string().openapi({ param: { name: "domain", in: "path" } }) }),
  },
  responses: { 200: json(SsoDomainOrgs, "The organizations."), ...errors(401) },
});
