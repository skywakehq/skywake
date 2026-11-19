import { OpenAPIHono } from "@hono/zod-openapi";

import * as audit from "./audit.ts";
import * as billing from "./billing.ts";
import * as environments from "./environments.ts";
import * as indexes from "./indexes/index.ts";
import * as keys from "./keys.ts";
import * as logins from "./logins.ts";
import * as orgs from "./orgs.ts";
import * as sso from "./sso.ts";
import * as v2 from "./v2/index.ts";

export * from "./http.ts";
export * from "./names.ts";
export * from "./schemas.ts";
export { audit, billing, environments, indexes, keys, logins, orgs, sso, v2 };

export const routes = {
  orgs: [
    orgs.createOrg,
    orgs.renameOrg,
    orgs.getIpAllowlist,
    orgs.setIpAllowlist,
    orgs.listInvoices,
    orgs.getInvoice,
  ],
  billing: [
    billing.getBilling,
    billing.startCheckout,
    billing.openPortal,
    billing.changePlan,
    billing.cancelSubscription,
    billing.resumeSubscription,
    billing.setPlan,
  ],
  sso: [sso.getSsoPolicy, sso.setSsoPolicy, sso.ssoDomainOrgs],
  keys: [
    keys.whoami,
    keys.listKeys,
    keys.createKey,
    keys.deleteKey,
    keys.revokeMemberKeys,
    logins.getLogin,
    logins.approveLogin,
  ],
  audit: [audit.auditLog, audit.recordAuditEvents],
  environments: [
    environments.listRegions,
    environments.listEnvironments,
    environments.createEnvironment,
    environments.getStoreTrust,
    environments.setEnvironmentStore,
    environments.removeEnvironmentStore,
  ],
  indexes: [
    indexes.listIndexes,
    indexes.createIndex,
    indexes.getIndex,
    indexes.updateIndex,
    indexes.deleteIndex,
    indexes.copyIndex,
    indexes.listIndexBranches,
    indexes.forkIndexBranch,
    indexes.listIndexVersions,
    indexes.restoreIndexBranch,
    indexes.getIndexBranch,
    indexes.mergeIndexBranch,
    indexes.deleteIndexBranch,
    indexes.upsertDocuments,
    indexes.listDocuments,
    indexes.getDocument,
    indexes.deleteDocuments,
    indexes.writeDocuments,
    indexes.exportDocuments,
    indexes.queryIndex,
    indexes.searchIndex,
    indexes.hybridQuery,
    indexes.orderDocuments,
    indexes.rankDocuments,
    indexes.aggregateDocuments,
    indexes.multiQuery,
    indexes.buildIndex,
    indexes.warmIndex,
    indexes.collectIndex,
    indexes.getIndexOperation,
    indexes.checkRecall,
    indexes.getIndexUsage,
  ],
};

export const BASE_PATH = "/v1";

export const info = {
  openapi: "3.1.0",
  info: {
    title: "Skywake API",
    version: "1.0.0",
    description:
      "Search indexes on object storage, with branches. Index and branch names may hold `/`; " +
      "encode it as `%2F` in paths. Send `Authorization: Bearer <API key or token>`.",
  },
  servers: [{ url: BASE_PATH }],
};

export function describe(app: OpenAPIHono<any>) {
  app.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
    type: "http",
    scheme: "bearer",
  });
}

export function document() {
  const app = new OpenAPIHono();
  describe(app);
  for (const route of Object.values(routes).flat()) app.openAPIRegistry.registerPath(route);
  return app.getOpenAPI31Document(info);
}
