import { getMigrations } from "better-auth/db/migration";
import { auth } from "./auth";
import { authPool } from "./db";
import { alignNames } from "./org-names";

/** Makes Better Auth's schema and tables, or brings them up to date. */
export async function prepareDatabase() {
  await authPool.query("CREATE SCHEMA IF NOT EXISTS auth");
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  // In the background, so a slow or missing API doesn't hold up start-up.
  void alignOrgNames().catch((error) => console.error("could not align organization names", error));
}

async function alignOrgNames() {
  const { rows } = await authPool.query<{ id: string; name: string }>(
    'SELECT id, name FROM organization ORDER BY "createdAt", id',
  );
  await alignNames(rows, ({ id, name }) =>
    authPool.query("UPDATE organization SET name = $1 WHERE id = $2", [name, id]),
  );
}
