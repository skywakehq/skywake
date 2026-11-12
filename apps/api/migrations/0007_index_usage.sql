CREATE TABLE "api"."index_usage" (
	"org" text NOT NULL,
	"index" text NOT NULL,
	"day" date NOT NULL,
	"queries" bigint DEFAULT 0 NOT NULL,
	"writes" bigint DEFAULT 0 NOT NULL,
	"deletes" bigint DEFAULT 0 NOT NULL,
	"rows" bigint,
	"bytes" bigint,
	CONSTRAINT "index_usage_pkey" PRIMARY KEY("org","index","day")
);
--> statement-breakpoint
ALTER TABLE "api"."index_usage" ADD CONSTRAINT "index_usage_org_index_fkey" FOREIGN KEY ("org","index") REFERENCES "api"."indexes"("org","name") ON DELETE cascade ON UPDATE no action;