DROP TABLE "api"."audit" CASCADE;
--> statement-breakpoint
CREATE TABLE "api"."audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"org" text,
	"owner" text,
	"actor" text,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"status" integer NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"resource" jsonb NOT NULL,
	"details" jsonb,
	"request_id" text NOT NULL,
	"client_request_id" text,
	"ip" text,
	"user_agent" text,
	"duration_ms" double precision NOT NULL,
	"bytes_in" bigint,
	"bytes_out" bigint,
	"chain" text NOT NULL,
	"seq" bigint NOT NULL,
	"prev" text,
	"hash" text NOT NULL,
	CONSTRAINT "audit_chain_seq" UNIQUE("chain","seq")
);
--> statement-breakpoint
CREATE INDEX "audit_by_org" ON "api"."audit" USING btree ("org","id");--> statement-breakpoint
CREATE INDEX "audit_by_owner" ON "api"."audit" USING btree ("owner","id") WHERE "api"."audit"."owner" is not null;--> statement-breakpoint
CREATE INDEX "audit_by_time" ON "api"."audit" USING btree ("at");--> statement-breakpoint
-- Dropping the old table took it out of the console's publication.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'console' AND schemaname = 'api' AND tablename = 'audit'
  ) THEN
    ALTER PUBLICATION console ADD TABLE api.audit;
  END IF;
END $$;
