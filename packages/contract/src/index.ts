import { OpenAPIHono } from "@hono/zod-openapi";

import * as audit from "./audit.ts";
import * as billing from "./billing.ts";
import * as branches from "./branches.ts";
import * as credentials from "./credentials.ts";
import * as environments from "./environments.ts";
import * as files from "./files.ts";
import * as history from "./history.ts";
import * as indexes from "./indexes/index.ts";
import * as keys from "./keys.ts";
import * as links from "./links.ts";
import * as namespaces from "./namespaces.ts";
import * as orgs from "./orgs.ts";
import * as sessions from "./sessions.ts";
import * as sso from "./sso.ts";

export * from "./http.ts";
export * from "./schemas.ts";
export {
  audit,
  billing,
  branches,
  credentials,
  environments,
  files,
  history,
  indexes,
  keys,
  links,
  namespaces,
  orgs,
  sessions,
  sso,
};

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
  keys: [keys.listKeys, keys.createKey, keys.deleteKey, keys.revokeMemberKeys],
  audit: [audit.auditLog, audit.recordAuditEvents],
  environments: [
    environments.listRegions,
    environments.listEnvironments,
    environments.createEnvironment,
    environments.getStoreTrust,
    environments.setEnvironmentStore,
    environments.removeEnvironmentStore,
  ],
  namespaces: [
    namespaces.listNamespaces,
    namespaces.createNamespace,
    namespaces.getNamespace,
    namespaces.updateNamespace,
  ],
  links: [
    links.linkIndex,
    links.getIndexLink,
    links.unlinkIndex,
    links.getBranchIndex,
    links.branchAdvanced,
  ],
  credentials: [credentials.createCredentials],
  branches: [
    branches.listBranches,
    branches.createBranch,
    branches.getBranch,
    branches.updateBranch,
    branches.deleteBranch,
  ],
  files: [files.listFiles, files.readFile, files.searchFiles, files.commitFiles, files.uploadPart],
  history: [
    history.listCommits,
    history.listChanges,
    history.fileHistory,
    history.diffBranches,
    history.mergeBranches,
    history.revertCommit,
    history.resetBranch,
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
  sessions: [
    sessions.listSessions,
    sessions.startSession,
    sessions.renewSession,
    sessions.endSession,
    sessions.listClaims,
    sessions.claimPath,
    sessions.releaseClaim,
  ],
};

export const BASE_PATH = "/v1";

export const info = {
  openapi: "3.1.0",
  info: {
    title: "Skywake API",
    version: "1.0.0",
    description:
      "Branches of whole filesystems, and search indexes, for agents. Namespace, index and branch " +
      "names may hold `/`; encode it " +
      "as `%2F` in paths. Send `Authorization: Bearer <API key or token>`. Public namespaces can be " +
      "read without one.",
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
