import { createRoute } from "@hono/zod-openapi";

import { body, errors, json, signedIn } from "./http.ts";
import { z } from "./schemas.ts";

export const NewOrg = z
  .object({
    name: z.string().min(1).max(100),
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional()
      .openapi({
        description:
          "The id, when the console made the organization. Then no key is made: its people sign in.",
      }),
  })
  .openapi("NewOrg");

export const CreatedOrg = z
  .object({
    id: z.string(),
    key: z
      .string()
      .nullable()
      .openapi({ description: "The first admin key, shown only this once." }),
  })
  .openapi("CreatedOrg");

export const createOrg = createRoute({
  method: "post",
  path: "/orgs",
  operationId: "createOrg",
  tags: ["orgs"],
  summary: "Creates an organization. Needs the server's admin token.",
  security: signedIn,
  request: { body: body(NewOrg) },
  responses: { 201: json(CreatedOrg, "The organization."), ...errors(400, 401, 409) },
});

const OrgParam = z.object({
  org: z
    .string()
    .openapi({ param: { name: "org", in: "path" }, description: "Your organization." }),
});

export const renameOrg = createRoute({
  method: "put",
  path: "/orgs/{org}/name",
  operationId: "renameOrg",
  tags: ["orgs"],
  summary:
    "Sets an organization's name, unique whatever the case. The console calls it to keep " +
    "names the same on both sides. Needs the server's admin token.",
  security: signedIn,
  request: {
    params: OrgParam,
    body: body(z.object({ name: NewOrg.shape.name }).openapi("OrgName")),
  },
  responses: {
    200: json(
      z.object({ id: z.string(), name: z.string() }).openapi("NamedOrg"),
      "The organization.",
    ),
    ...errors(400, 401, 404, 409),
  },
});

export const IpAllowlist = z
  .object({
    cidrs: z
      .array(z.string().max(64))
      .max(100)
      .openapi({
        description:
          "Addresses the organization's keys and console sessions may call from, as CIDRs such " +
          "as `203.0.113.0/24` or `2001:db8::/32`; a lone address means only itself. Empty: any.",
        example: ["203.0.113.0/24"],
      }),
  })
  .openapi("IpAllowlist");

export const getIpAllowlist = createRoute({
  method: "get",
  path: "/orgs/{org}/ip-allowlist",
  operationId: "getIpAllowlist",
  tags: ["orgs"],
  summary: "Where the organization's keys and people may call from. Needs an org admin.",
  security: signedIn,
  request: { params: OrgParam },
  responses: { 200: json(IpAllowlist, "The list."), ...errors(401, 403, 404) },
});

export const setIpAllowlist = createRoute({
  method: "put",
  path: "/orgs/{org}/ip-allowlist",
  operationId: "setIpAllowlist",
  tags: ["orgs"],
  summary: "Sets where the organization's keys and people may call from. Needs an org admin.",
  description:
    "Calls from anywhere else answer 403 `ip_not_allowed`. A list that leaves out the address of " +
    "the call that sets it is refused, so an admin never locks themselves out.",
  security: signedIn,
  request: { params: OrgParam, body: body(IpAllowlist) },
  responses: { 200: json(IpAllowlist, "The new list."), ...errors(400, 401, 403, 404, 409) },
});

const Month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "a month such as `2026-11`")
  .openapi({ example: "2026-11" });

const cents = (description: string) => z.number().int().openapi({ description });

export const InvoiceItem = z
  .enum(["storage", "writes", "queries", "embeddings", "reranks", "pinned"])
  .openapi("InvoiceItem", {
    description:
      "What a line charges for. Storage is in GB-months: the size of `main` each day, over the " +
      "days of the month. Writes are GB written. Queries are TB scanned: each query counts the " +
      "size of the index it searched. Pinned is in GB-hours: the size of `main` for each hour of " +
      "each replica; a pinned index's queries are not charged.",
  });

export type InvoiceItem = z.infer<typeof InvoiceItem>;

export const InvoiceLine = z
  .object({
    index: z.string(),
    item: InvoiceItem,
    quantity: z.number().openapi({
      description:
        "Units used: GB-months of storage, GB written, TB scanned, texts, documents, GB-hours.",
    }),
    unit_price: z.number().openapi({ description: "Dollars per unit." }),
    amount_cents: cents("The quantity times the unit price, in cents, rounded."),
  })
  .openapi("InvoiceLine");

export const InvoiceSummary = z
  .object({
    month: Month,
    status: z.enum(["open", "closed"]).openapi({
      description: "`open` for the month under way, which still grows.",
    }),
    currency: z.literal("usd"),
    total_cents: cents("The sum of the lines."),
  })
  .openapi("InvoiceSummary");

export const Invoice = InvoiceSummary.extend({
  lines: z.array(InvoiceLine).openapi({ description: "Per index and item; none for zero use." }),
}).openapi("Invoice");
export type Invoice = z.infer<typeof Invoice>;

export const listInvoices = createRoute({
  method: "get",
  path: "/orgs/{org}/invoices",
  operationId: "listInvoices",
  tags: ["orgs"],
  summary: "The organization's invoices, newest first, made from its indexes' usage.",
  security: signedIn,
  request: { params: OrgParam },
  responses: { 200: json(z.array(InvoiceSummary), "The invoices."), ...errors(401, 403, 404) },
});

export const getInvoice = createRoute({
  method: "get",
  path: "/orgs/{org}/invoices/{month}",
  operationId: "getInvoice",
  tags: ["orgs"],
  summary: "One month's invoice, with a line per index and item.",
  security: signedIn,
  request: {
    params: OrgParam.extend({ month: Month.openapi({ param: { name: "month", in: "path" } }) }),
  },
  responses: { 200: json(Invoice, "The invoice."), ...errors(400, 401, 403, 404) },
});
