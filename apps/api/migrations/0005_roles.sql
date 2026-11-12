-- zero-cache copies the published tables into browsers, so it may read
-- them; never keys. The role exists only where docker/postgres/roles.sh ran;
-- elsewhere this does nothing. A table added to the publication needs a
-- grant here too, in a new migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skywake_zero') THEN
    GRANT USAGE ON SCHEMA api TO skywake_zero;
    GRANT SELECT ON api.environments, api.namespaces, api.branches, api.commits, api.sessions,
      api.claims, api.audit TO skywake_zero;
  END IF;
END $$;
