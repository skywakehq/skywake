CREATE TABLE "api"."deletions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"folder" text NOT NULL,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" text,
	"claimed_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deletions_due" ON "api"."deletions" USING btree ("due");--> statement-breakpoint
CREATE INDEX "deletions_region" ON "api"."deletions" USING btree ("region");