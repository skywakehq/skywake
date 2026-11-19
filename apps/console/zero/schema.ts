import { createBuilder, createSchema, number, string, table } from "@rocicorp/zero";

// The tables skywake-api keeps in Postgres. Zero copies the rows each person
// may see into their browser and keeps them current.

const environment = table("environment")
  .from("api.environments")
  .columns({ org: string(), name: string(), created: number() })
  .primaryKey("org", "name");

export const schema = createSchema({ tables: [environment] });

export const zql = createBuilder(schema);

/** Who is asking. Every query and change is limited to `org`. */
export type Context = { userID: string; org: string };

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    schema: typeof schema;
    context: Context;
  }
}
