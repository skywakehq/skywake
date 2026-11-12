CREATE TABLE "api"."index_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"org" text NOT NULL,
	"index" text NOT NULL,
	"branch" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"started" timestamp with time zone DEFAULT now() NOT NULL,
	"finished" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api"."index_operations" ADD CONSTRAINT "index_operations_org_index_fkey" FOREIGN KEY ("org","index") REFERENCES "api"."indexes"("org","name") ON DELETE cascade ON UPDATE no action;