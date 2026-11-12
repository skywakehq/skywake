-- Tells every API server, after each commit, which keys, indexes, names and
-- organizations changed, so they drop what they remembered of them.
CREATE OR REPLACE FUNCTION "api"."notify_change"() RETURNS trigger AS $$
DECLARE
	row record;
	body json;
BEGIN
	IF TG_OP = 'DELETE' THEN
		row := OLD;
	ELSE
		row := NEW;
	END IF;
	IF TG_TABLE_NAME = 'keys' THEN
		body := json_build_object('table', 'keys', 'id', row.id);
	ELSIF TG_TABLE_NAME = 'orgs' THEN
		body := json_build_object('table', 'orgs', 'org', row.id);
	ELSE
		body := json_build_object('table', TG_TABLE_NAME, 'org', row.org, 'name', row.name);
	END IF;
	PERFORM pg_notify('skywake_changes', body::text);
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "keys_changed" AFTER DELETE OR UPDATE OF "org", "hash", "role", "namespaces", "expires" ON "api"."keys" FOR EACH ROW EXECUTE FUNCTION "api"."notify_change"();
--> statement-breakpoint
CREATE TRIGGER "orgs_changed" AFTER DELETE OR UPDATE OF "ip_allowlist" ON "api"."orgs" FOR EACH ROW EXECUTE FUNCTION "api"."notify_change"();
--> statement-breakpoint
CREATE TRIGGER "indexes_changed" AFTER DELETE OR UPDATE ON "api"."indexes" FOR EACH ROW EXECUTE FUNCTION "api"."notify_change"();
--> statement-breakpoint
CREATE TRIGGER "compat_namespaces_changed" AFTER INSERT OR DELETE OR UPDATE ON "api"."compat_namespaces" FOR EACH ROW EXECUTE FUNCTION "api"."notify_change"();
