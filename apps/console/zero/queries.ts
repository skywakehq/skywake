import { defineQueries, defineQuery } from "@rocicorp/zero";
import { zql } from "./schema.ts";

// Each query is limited to the caller's organization. The server runs the
// same code with the organization from the sign-in session.
export const queries = defineQueries({
  environments: defineQuery(({ ctx }) =>
    zql.environment.where("org", ctx.org).orderBy("name", "asc"),
  ),
});
