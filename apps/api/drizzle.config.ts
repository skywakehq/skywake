import { defineConfig } from "drizzle-kit";

import { MIGRATIONS } from "./src/db/migrations.ts";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  schemaFilter: ["api"],
  migrations: MIGRATIONS,
});
