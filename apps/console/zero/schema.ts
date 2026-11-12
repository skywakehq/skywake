import {
  boolean,
  createBuilder,
  createSchema,
  json,
  number,
  relationships,
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
    session: string().optional(),
    merged: string().optional(),
    actor: string(),
    changes: json<Change[]>(),
    at: number(),
    agent: string().optional(),
  })
  .primaryKey("org", "namespace", "branch", "hash");

const session = table("session")
  .from("api.sessions")
  .columns({
    id: string(),
    org: string(),
    namespace: string(),
    label: string(),
    actor: string(),
    expires: number(),
    created: number(),
  })
  .primaryKey("id");

const claim = table("claim")
  .from("api.claims")
  .columns({
    org: string(),
    namespace: string(),
    branch: string(),
    path: string(),
    session: string(),
    created: number(),
  })
  .primaryKey("org", "namespace", "branch", "path");

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

const sessionClaims = relationships(session, ({ many }) => ({
  claims: many({ sourceField: ["id"], destField: ["session"], destSchema: claim }),
}));

export const schema = createSchema({
  tables: [environment, namespace, branch, commit, session, claim, audit],
  relationships: [sessionClaims],
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
export type Session = Rows["session"];
export type Audit = Rows["audit"];
export type Claim = Rows["claim"];

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    schema: typeof schema;
    context: Context;
  }
}
