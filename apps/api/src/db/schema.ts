import type { indexes as contract } from "@skywake/contract";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { ActorKind, Outcome } from "../audit/event.ts";

type IndexSchema = contract.IndexSchema;

/** How the API signs for a bucket a customer brings. No secret is kept in the clear. */
export type StoreAccess =
  | { type: "aws_role"; roleArn: string; externalId: string; region: string }
  | {
      type: "keys";
      accessKeyId: string;
      /** Sealed with SKYWAKE_API_SECRET_KEY (`security/sealed.ts`). */
      secret: string;
      endpoint: string | null;
      region: string;
    };

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const time = (name: string) => timestamp(name, { withTimezone: true });

export const api = pgSchema("api");

export const orgs = api.table(
  "orgs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    created: time("created").notNull().defaultNow(),
    ipAllowlist: text("ip_allowlist").array().notNull().default([]),
  },
  (table) => [uniqueIndex("orgs_name_unique").on(sql`lower(${table.name})`)],
);

export const ssoDomains = api.table(
  "sso_domains",
  {
    org: text("org").notNull(),
    domain: text("domain").notNull(),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "sso_domains_pkey", columns: [table.org, table.domain] }),
    index("sso_domains_by_domain").on(table.domain),
    foreignKey({
      name: "sso_domains_org_fkey",
      columns: [table.org],
      foreignColumns: [orgs.id],
    }).onDelete("cascade"),
  ],
);

export const keys = api.table(
  "keys",
  {
    id: text("id").primaryKey(),
    org: text("org").notNull(),
    hash: bytea("hash").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    namespaces: text("namespaces").notNull(),
    expires: time("expires"),
    lastUsed: time("last_used"),
    created: time("created").notNull().defaultNow(),
    createdBy: text("created_by"),
    createdByEmail: text("created_by_email"),
  },
  (table) => [
    index("keys_created_by").on(table.org, table.createdBy),
    foreignKey({ name: "keys_org_fkey", columns: [table.org], foreignColumns: [orgs.id] }).onDelete(
      "cascade",
    ),
  ],
);

export const environments = api.table(
  "environments",
  {
    org: text("org").notNull(),
    name: text("name").notNull(),
    // A bucket the customer brings: every namespace and index made in the
    // environment after it is set lives there. Null: the server's regions.
    store: text("store"),
    storeAccess: jsonb("store_access").$type<StoreAccess>(),
    storeVerified: time("store_verified"),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "environments_pkey", columns: [table.org, table.name] }),
    foreignKey({
      name: "environments_org_fkey",
      columns: [table.org],
      foreignColumns: [orgs.id],
    }).onDelete("cascade"),
  ],
);

export const namespaces = api.table(
  "namespaces",
  {
    org: text("org").notNull(),
    name: text("name").notNull(),
    folder: text("folder").notNull().unique("namespaces_folder_key"),
    region: text("region").notNull(),
    visibility: text("visibility").notNull().default("private"),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "namespaces_pkey", columns: [table.org, table.name] }),
    foreignKey({
      name: "namespaces_org_fkey",
      columns: [table.org],
      foreignColumns: [orgs.id],
    }).onDelete("cascade"),
  ],
);

export const branches = api.table(
  "branches",
  {
    org: text("org").notNull(),
    namespace: text("namespace").notNull(),
    name: text("name").notNull(),
    forkedFrom: text("forked_from"),
    protected: boolean("protected").notNull().default(false),
    head: text("head"),
    updated: time("updated").notNull().defaultNow(),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "branches_pkey", columns: [table.org, table.namespace, table.name] }),
    foreignKey({
      name: "branches_org_namespace_fkey",
      columns: [table.org, table.namespace],
      foreignColumns: [namespaces.org, namespaces.name],
    }).onDelete("cascade"),
  ],
);

export const indexes = api.table(
  "indexes",
  {
    org: text("org").notNull(),
    name: text("name").notNull(),
    folder: text("folder").notNull().unique("indexes_folder_key"),
    region: text("region").notNull(),
    schema: jsonb("schema").$type<IndexSchema>().notNull(),
    shards: integer("shards").notNull().default(1),
    kmsKeyId: text("kms_key_id"),
    readOnly: boolean("read_only").notNull().default(false),
    retentionDays: integer("retention_days"),
    pinnedReplicas: integer("pinned_replicas"),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "indexes_pkey", columns: [table.org, table.name] }),
    foreignKey({
      name: "indexes_org_fkey",
      columns: [table.org],
      foreignColumns: [orgs.id],
    }).onDelete("cascade"),
    index("indexes_pinned")
      .on(table.org)
      .where(sql`pinned_replicas IS NOT NULL`),
  ],
);

export const indexBranches = api.table(
  "index_branches",
  {
    org: text("org").notNull(),
    index: text("index").notNull(),
    name: text("name").notNull(),
    forkedFrom: text("forked_from"),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "index_branches_pkey", columns: [table.org, table.index, table.name] }),
    foreignKey({
      name: "index_branches_org_index_fkey",
      columns: [table.org, table.index],
      foreignColumns: [indexes.org, indexes.name],
    }).onDelete("cascade"),
  ],
);

export const indexLeases = api.table(
  "index_leases",
  {
    folder: text("folder").notNull(),
    holder: text("holder").notNull(),
    expires: time("expires").notNull(),
    revoked: boolean("revoked").notNull().default(false),
  },
  (table) => [primaryKey({ name: "index_leases_pkey", columns: [table.folder, table.holder] })],
);

export const compatNamespaces = api.table(
  "compat_namespaces",
  {
    org: text("org").notNull(),
    name: text("name").notNull(),
    index: text("index").notNull(),
    branch: text("branch").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "compat_namespaces_pkey", columns: [table.org, table.name] }),
    foreignKey({
      name: "compat_namespaces_org_index_fkey",
      columns: [table.org, table.index],
      foreignColumns: [indexes.org, indexes.name],
    }).onDelete("cascade"),
  ],
);

export const indexOperations = api.table(
  "index_operations",
  {
    id: text("id").primaryKey(),
    org: text("org").notNull(),
    index: text("index").notNull(),
    branch: text("branch"),
    kind: text("kind").$type<contract.OperationKind>().notNull(),
    status: text("status").$type<contract.OperationStatus>().notNull().default("running"),
    error: text("error"),
    started: time("started").notNull().defaultNow(),
    finished: time("finished"),
    requestedBy: text("requested_by"),
  },
  (table) => [
    foreignKey({
      name: "index_operations_org_index_fkey",
      columns: [table.org, table.index],
      foreignColumns: [indexes.org, indexes.name],
    }).onDelete("cascade"),
  ],
);

export const indexUsage = api.table(
  "index_usage",
  {
    org: text("org").notNull(),
    index: text("index").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    queries: bigint("queries", { mode: "number" }).notNull().default(0),
    writes: bigint("writes", { mode: "number" }).notNull().default(0),
    deletes: bigint("deletes", { mode: "number" }).notNull().default(0),
    embeddings: bigint("embeddings", { mode: "number" }).notNull().default(0),
    reranks: bigint("reranks", { mode: "number" }).notNull().default(0),
    rows: bigint("rows", { mode: "number" }),
    bytes: bigint("bytes", { mode: "number" }),
    pinnedMs: bigint("pinned_ms", { mode: "number" }).notNull().default(0),
    bytesWritten: bigint("bytes_written", { mode: "number" }).notNull().default(0),
    bytesScanned: bigint("bytes_scanned", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    primaryKey({ name: "index_usage_pkey", columns: [table.org, table.index, table.day] }),
    foreignKey({
      name: "index_usage_org_index_fkey",
      columns: [table.org, table.index],
      foreignColumns: [indexes.org, indexes.name],
    }).onDelete("cascade"),
  ],
);

export const sessions = api.table(
  "sessions",
  {
    id: text("id").primaryKey(),
    org: text("org").notNull(),
    namespace: text("namespace").notNull(),
    label: text("label").notNull(),
    actor: text("actor").notNull(),
    expires: time("expires").notNull(),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "sessions_org_namespace_fkey",
      columns: [table.org, table.namespace],
      foreignColumns: [namespaces.org, namespaces.name],
    }).onDelete("cascade"),
    index("sessions_by_namespace").on(table.org, table.namespace, table.expires),
    index("sessions_by_expiry").on(table.expires),
  ],
);

export const claims = api.table(
  "claims",
  {
    org: text("org").notNull(),
    namespace: text("namespace").notNull(),
    branch: text("branch").notNull(),
    path: text("path").notNull(),
    session: text("session").notNull(),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "claims_pkey",
      columns: [table.org, table.namespace, table.branch, table.path],
    }),
    foreignKey({
      name: "claims_session_fkey",
      columns: [table.session],
      foreignColumns: [sessions.id],
    }).onDelete("cascade"),
    index("claims_by_session").on(table.session),
    foreignKey({
      name: "claims_org_namespace_branch_fkey",
      columns: [table.org, table.namespace, table.branch],
      foreignColumns: [branches.org, branches.namespace, branches.name],
    }).onDelete("cascade"),
  ],
);

export const audit = api.table(
  "audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: time("at").notNull(),
    org: text("org"),
    owner: text("owner"),
    actor: text("actor"),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    action: text("action").notNull(),
    outcome: text("outcome").$type<Outcome>().notNull(),
    status: integer("status").notNull(),
    method: text("method").notNull(),
    route: text("route").notNull(),
    resource: jsonb("resource").$type<Record<string, string>>().notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    requestId: text("request_id").notNull(),
    clientRequestId: text("client_request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    durationMs: doublePrecision("duration_ms").notNull(),
    bytesIn: bigint("bytes_in", { mode: "number" }),
    bytesOut: bigint("bytes_out", { mode: "number" }),
    chain: text("chain").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    prev: text("prev"),
    hash: text("hash").notNull(),
  },
  (table) => [
    index("audit_by_org").on(table.org, table.id),
    index("audit_by_owner")
      .on(table.owner, table.id)
      .where(sql`${table.owner} is not null`),
    index("audit_by_time").on(table.at),
    unique("audit_chain_seq").on(table.chain, table.seq),
  ],
);

export const commits = api.table(
  "commits",
  {
    org: text("org").notNull(),
    namespace: text("namespace").notNull(),
    branch: text("branch").notNull(),
    hash: text("hash").notNull(),
    parent: text("parent"),
    message: text("message").notNull(),
    session: text("session"),
    merged: text("merged"),
    actor: text("actor").notNull(),
    agent: text("agent"),
    changes: jsonb("changes").notNull(),
    at: time("at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "commits_pkey",
      columns: [table.org, table.namespace, table.branch, table.hash],
    }),
    foreignKey({
      name: "commits_org_namespace_branch_fkey",
      columns: [table.org, table.namespace, table.branch],
      foreignColumns: [branches.org, branches.namespace, branches.name],
    }).onDelete("cascade"),
    index("commits_by_time").on(table.org, table.namespace, table.at),
  ],
);

export const rateLimits = api.table("rate_limits", {
  client: text("client").primaryKey(),
  window: bigint("window", { mode: "number" }).notNull(),
  count: integer("count").notNull(),
});

export const uploadParts = api.table(
  "upload_parts",
  {
    org: text("org").notNull(),
    namespace: text("namespace").notNull(),
    part: text("part").notNull(),
    size: integer("size").notNull(),
    chunks: jsonb("chunks").$type<{ hash: string; size: number }[]>().notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "upload_parts_pkey", columns: [table.org, table.namespace, table.part] }),
    foreignKey({
      name: "upload_parts_org_namespace_fkey",
      columns: [table.org, table.namespace],
      foreignColumns: [namespaces.org, namespaces.name],
    }).onDelete("cascade"),
    index("upload_parts_by_age").on(table.createdAt),
  ],
);

export const peers = api.table("peers", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  seen: time("seen").notNull(),
  serving: jsonb("serving").$type<Record<string, { warm: boolean; in_flight: number }>>().notNull(),
});

export const leases = api.table("leases", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  expires: time("expires").notNull(),
});

export const billingAccounts = api.table("billing_accounts", {
  org: text("org")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  customer: text("customer").unique("billing_accounts_customer_key"),
  subscription: text("subscription"),
  plan: text("plan").$type<"launch" | "scale">(),
  nextPlan: text("next_plan").$type<"launch" | "scale">(),
  status: text("status"),
  startedAt: time("started_at"),
  periodStart: time("period_start"),
  periodEnd: time("period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  endedAt: time("ended_at"),
  pastDueSince: time("past_due_since"),
  override: text("override").$type<"enterprise">(),
  updated: time("updated").notNull().defaultNow(),
});

export const billingUsage = api.table(
  "billing_usage",
  {
    org: text("org")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    meter: text("meter").notNull(),
    hour: time("hour").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
  },
  (table) => [
    primaryKey({ name: "billing_usage_pkey", columns: [table.org, table.meter, table.hour] }),
  ],
);

export const billingReports = api.table(
  "billing_reports",
  {
    org: text("org")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    meter: text("meter").notNull(),
    subscription: text("subscription").notNull(),
    next: time("next").notNull(),
    remainder: bigint("remainder", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
  },
  (table) => [primaryKey({ name: "billing_reports_pkey", columns: [table.org, table.meter] })],
);

export const filesystemSizes = api.table(
  "filesystem_sizes",
  {
    folder: text("folder")
      .primaryKey()
      .references(() => namespaces.folder, { onDelete: "cascade" }),
    org: text("org")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    bytes: bigint("bytes", { mode: "bigint" }).notNull(),
    objects: bigint("objects", { mode: "number" }).notNull(),
    measured: time("measured").notNull(),
    stale: boolean("stale").notNull().default(false),
  },
  (table) => [index("filesystem_sizes_by_org").on(table.org)],
);

// A namespace whose files an index keeps up with. One per namespace.
export const indexLinks = api.table(
  "index_links",
  {
    org: text("org").notNull(),
    namespace: text("namespace").notNull(),
    index: text("index").notNull(),
    include: text("include").array().notNull().default(sql`'{}'`),
    exclude: text("exclude").array().notNull().default(sql`'{}'`),
    maxBytes: integer("max_bytes").notNull(),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "index_links_pkey", columns: [table.org, table.namespace] }),
    foreignKey({
      name: "index_links_namespace_fkey",
      columns: [table.org, table.namespace],
      foreignColumns: [namespaces.org, namespaces.name],
    }).onDelete("cascade"),
    foreignKey({
      name: "index_links_index_fkey",
      columns: [table.org, table.index],
      foreignColumns: [indexes.org, indexes.name],
    }).onDelete("cascade"),
  ],
);

// One linked branch: the commit its index branch matches, and whether it is
// behind. Servers claim due rows with SKIP LOCKED; a claim that runs out is
// taken again, so a server that dies mid-sync costs only time.
export const indexLinkBranches = api.table(
  "index_link_branches",
  {
    org: text("org").notNull(),
    namespace: text("namespace").notNull(),
    branch: text("branch").notNull(),
    synced: text("synced"),
    dirty: boolean("dirty").notNull().default(true),
    due: time("due").notNull().defaultNow(),
    checked: time("checked").notNull().defaultNow(),
    claimedBy: text("claimed_by"),
    claimedUntil: time("claimed_until"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    syncedAt: time("synced_at"),
  },
  (table) => [
    primaryKey({
      name: "index_link_branches_pkey",
      columns: [table.org, table.namespace, table.branch],
    }),
    foreignKey({
      name: "index_link_branches_link_fkey",
      columns: [table.org, table.namespace],
      foreignColumns: [indexLinks.org, indexLinks.namespace],
    }).onDelete("cascade"),
    index("index_link_branches_due")
      .on(table.due)
      .where(sql`dirty`),
    index("index_link_branches_checked").on(table.checked),
  ],
);

// Which index version matches which commit of a linked branch: how a search
// pins a commit, and where an index fork starts.
export const indexStamps = api.table(
  "index_stamps",
  {
    org: text("org").notNull(),
    index: text("index").notNull(),
    branch: text("branch").notNull(),
    commit: text("commit").notNull(),
    version: text("version").notNull(),
    at: time("at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "index_stamps_pkey",
      columns: [table.org, table.index, table.branch, table.commit],
    }),
    foreignKey({
      name: "index_stamps_index_fkey",
      columns: [table.org, table.index],
      foreignColumns: [indexes.org, indexes.name],
    }).onDelete("cascade"),
    index("index_stamps_newest").on(table.org, table.index, table.branch, table.at),
  ],
);

// Data to delete from a bucket: a namespace's or index's folder whose row is
// gone. No foreign key, so it outlives the row; the row's removal and this
// insert are one statement, so a folder is never forgotten. Servers claim
// rows with SKIP LOCKED and retry until the folder is empty.
export const deletions = api.table(
  "deletions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    org: text("org").notNull(),
    kind: text("kind").$type<"namespace" | "index">().notNull(),
    name: text("name").notNull(),
    region: text("region").notNull(),
    folder: text("folder").notNull(),
    due: time("due").notNull().defaultNow(),
    claimedBy: text("claimed_by"),
    claimedUntil: time("claimed_until"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    created: time("created").notNull().defaultNow(),
  },
  (table) => [index("deletions_due").on(table.due), index("deletions_region").on(table.region)],
);
