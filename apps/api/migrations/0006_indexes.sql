CREATE TABLE "api"."index_branches" (
	"org" text NOT NULL,
	"index" text NOT NULL,
	"name" text NOT NULL,
	"forked_from" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_branches_pkey" PRIMARY KEY("org","index","name")
);
--> statement-breakpoint
CREATE TABLE "api"."indexes" (
	"org" text NOT NULL,
	"name" text NOT NULL,
	"folder" text NOT NULL,
	"region" text NOT NULL,
	"schema" jsonb NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexes_pkey" PRIMARY KEY("org","name"),
	CONSTRAINT "indexes_folder_key" UNIQUE("folder")
);
--> statement-breakpoint
ALTER TABLE "api"."index_branches" ADD CONSTRAINT "index_branches_org_index_fkey" FOREIGN KEY ("org","index") REFERENCES "api"."indexes"("org","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."indexes" ADD CONSTRAINT "indexes_org_fkey" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;