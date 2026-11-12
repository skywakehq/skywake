CREATE TABLE "api"."peers" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"seen" timestamp with time zone NOT NULL,
	"serving" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."index_usage" ADD COLUMN "pinned_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."indexes" ADD COLUMN "pinned_replicas" integer;