#!/bin/sh
# Gives each service its own Postgres role with only what it needs, instead
# of the superuser. Postgres runs this once, when it makes the database.
# On a database made before, run it yourself; it is safe to run again:
#   docker compose exec postgres sh /docker-entrypoint-initdb.d/roles.sh
#
#   skywake_api      owns the `api` schema and the publication of its tables.
#   skywake_console  owns the `auth` schema (Better Auth). It changes the API's
#                    data only over HTTP; it may read the tables Zero syncs.
#   skywake_zero     copies the published `api` tables to browsers, and keeps
#                    its own state in schemas it makes. It needs REPLICATION,
#                    and with that it can decode every change to every table
#                    in this database, keys and `auth` included: treat
#                    zero-cache as trusted as the API (see docker/README.md).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" -v owner="$POSTGRES_USER" \
  -v api="${API_DB_PASSWORD:?}" -v console="${CONSOLE_DB_PASSWORD:?}" -v zero="${ZERO_DB_PASSWORD:?}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', name) FROM unnest(ARRAY['skywake_api', 'skywake_console', 'skywake_zero']) AS name
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = name) \gexec
ALTER ROLE skywake_api PASSWORD :'api';
ALTER ROLE skywake_console PASSWORD :'console';
ALTER ROLE skywake_zero PASSWORD :'zero';
-- Only a superuser may give REPLICATION. Amazon RDS has no superuser and
-- grants the same right as the rds_replication role.
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_replication')
  THEN 'GRANT rds_replication TO skywake_zero'
  ELSE 'ALTER ROLE skywake_zero REPLICATION' END \gexec
-- The owner hands schemas to these roles, which needs membership. A
-- superuser has it already; on RDS (Postgres 16+) the owner must take it.
GRANT skywake_api, skywake_console, skywake_zero TO :"owner";

-- Making schemas and publications needs CREATE on the database.
GRANT CREATE ON DATABASE :"db" TO skywake_api, skywake_console, skywake_zero;
CREATE SCHEMA IF NOT EXISTS api AUTHORIZATION skywake_api;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION skywake_console;

-- The console records which of Zero's changes it applied, in Zero's tables.
ALTER DEFAULT PRIVILEGES FOR ROLE skywake_zero GRANT USAGE ON SCHEMAS TO skywake_console;
ALTER DEFAULT PRIVILEGES FOR ROLE skywake_zero
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skywake_console;

-- A database made before the roles: hand each service what it made.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT nspname FROM pg_namespace WHERE nspname IN ('api', 'auth') LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', item.nspname,
      CASE item.nspname WHEN 'api' THEN 'skywake_api' ELSE 'skywake_console' END);
  END LOOP;
  FOR item IN
    SELECT n.nspname, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('api', 'auth') AND c.relkind IN ('r', 'S', 'v', 'p')
      -- A table's own sequences move with it.
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))
  LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO %I',
      CASE item.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END,
      item.nspname, item.relname,
      CASE item.nspname WHEN 'api' THEN 'skywake_api' ELSE 'skywake_console' END);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'console') THEN
    ALTER PUBLICATION console OWNER TO skywake_api;
  END IF;
  -- The same grants as the API's migration 0005_roles.sql, which ran before the role existed.
  IF to_regclass('api.audit') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA api TO skywake_zero;
    GRANT SELECT ON api.environments, api.namespaces, api.branches, api.commits, api.sessions,
      api.claims, api.audit TO skywake_zero;
    -- The API's migration 0022: Zero checks the console's mutations against these.
    GRANT USAGE ON SCHEMA api TO skywake_console;
    GRANT SELECT ON api.environments, api.namespaces, api.branches, api.commits, api.sessions,
      api.claims, api.audit TO skywake_console;
  END IF;
END $$;
SQL
