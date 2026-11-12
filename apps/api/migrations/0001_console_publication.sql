-- The tables the console's sync engine (Zero) copies into browsers. Keys
-- are left out: browsers never need their hashes. A new table the console
-- shows must be added here, in a new migration.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'console') THEN
    CREATE PUBLICATION console;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['environments', 'namespaces', 'branches', 'commits', 'sessions', 'claims', 'audit'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'console' AND schemaname = 'api' AND tablename = name
    ) THEN
      EXECUTE format('ALTER PUBLICATION console ADD TABLE api.%I', name);
    END IF;
  END LOOP;
END $$;
