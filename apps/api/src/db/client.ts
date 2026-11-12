import { fileURLToPath } from "node:url";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { MIGRATIONS } from "./migrations.ts";
import * as schema from "./schema.ts";

export type Db = NodePgDatabase<typeof schema>;

export function connect(url: string, max: number) {
  const pool = new pg.Pool({ connectionString: url, max });
  return { db: drizzle(pool, { schema }), pool };
}

const MIGRATION_LOCK = 7302446;

export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await runMigrations(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)),
      migrationsSchema: MIGRATIONS.schema,
      migrationsTable: MIGRATIONS.table,
    });
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}
