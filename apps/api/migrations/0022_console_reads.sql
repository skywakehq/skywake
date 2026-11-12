-- Fixes two grants a self-hosted install needs, where each service has its own role.
DO $$ BEGIN
  -- 0016 made api.audit again, which dropped zero-cache's grant from 0005, so
  -- zero-cache stopped at start with "permission denied for table audit".
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skywake_zero') THEN
    GRANT SELECT ON api.audit TO skywake_zero;
  END IF;
  -- The console's Zero mutations go to the API over HTTP, but Zero checks its
  -- schema against these tables first, so the console must see them.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skywake_console') THEN
    GRANT USAGE ON SCHEMA api TO skywake_console;
    GRANT SELECT ON api.environments, api.namespaces, api.branches, api.commits, api.sessions,
      api.claims, api.audit TO skywake_console;
  END IF;
END $$;
