import {
  boolean,
  createBuilder,
  createSchema,
  json,
  number,
  type ReadonlyJSONValue,
  type Row,
  string,
  table,
} from "@rocicorp/zero";

// The tables skywake-api keeps in Postgres. Zero copies the rows each person
// may see into their browser and keeps them current.

const environment = table("environment")
  .from("api.environments")
  .columns({ org: string(), name: string(), created: number() })
  .primaryKey("org", "name");

const namespace = table("namespace")
  .from("api.namespaces")
  .columns({ org: string(), name: string(), region: string(), created: number() })
  .primaryKey("org", "name");

const branch = table("branch")
  .from("api.branches")
  .columns({
    org: string(),
    namespace: string(),
    name: string(),
    forkedFrom: string().from("forked_from").optional(),
    protected: boolean(),
    head: string().optional(),
    created: number(),
    updated: number(),
  })
  .primaryKey("org", "namespace", "name");

export type Change = { kind: "added" | "removed" | "modified"; path: string };

const commit = table("commit")
  .from("api.commits")
  .columns({
    org: string(),
    namespace: string(),
    branch: string(),
    hash: string(),
    parent: string().optional(),
    message: string(),
    merged: string().optional(),
    actor: string(),
    changes: json<Change[]>(),
    at: number(),
  })
  .primaryKey("org", "namespace", "branch", "hash");

const audit = table("audit")
  .from("api.audit")
  .columns({
    id: number(),
    org: string().optional(),
    actor: string().optional(),
    action: string(),
    outcome: string(),
    resource: json<Record<string, string>>(),
    details: json<{ [key: string]: ReadonlyJSONValue }>().optional(),
    at: number(),
  })
  .primaryKey("id");

export const schema = createSchema({
  tables: [environment, namespace, branch, commit, audit],
});

export const zql = createBuilder(schema);

/**
 * Who is asking. Every query and change is limited to `org`; `role` decides
 * whether the audit log is read.
 */
export type Context = { userID: string; org: string; role: string };

type Rows = Row<typeof schema>;
export type Environment = Rows["environment"];
export type Branch = Rows["branch"];
export type Commit = Rows["commit"];
export type Audit = Rows["audit"];

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    schema: typeof schema;
    context: Context;
  }
}
