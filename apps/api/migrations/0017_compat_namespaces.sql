CREATE TABLE "api"."compat_namespaces" (
	"org" text NOT NULL,
	"name" text NOT NULL,
	"index" text NOT NULL,
	"branch" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compat_namespaces_pkey" PRIMARY KEY("org","name")
);
--> statement-breakpoint
ALTER TABLE "api"."compat_namespaces" ADD CONSTRAINT "compat_namespaces_org_index_fkey" FOREIGN KEY ("org","index") REFERENCES "api"."indexes"("org","name") ON DELETE cascade ON UPDATE no action;