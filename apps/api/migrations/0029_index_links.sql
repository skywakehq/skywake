CREATE TABLE "api"."index_link_branches" (
	"org" text NOT NULL,
	"namespace" text NOT NULL,
	"branch" text NOT NULL,
	"synced" text,
	"dirty" boolean DEFAULT true NOT NULL,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"checked" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" text,
	"claimed_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"synced_at" timestamp with time zone,
	CONSTRAINT "index_link_branches_pkey" PRIMARY KEY("org","namespace","branch")
);
--> statement-breakpoint
CREATE TABLE "api"."index_links" (
	"org" text NOT NULL,
	"namespace" text NOT NULL,
	"index" text NOT NULL,
	"include" text[] DEFAULT '{}' NOT NULL,
	"exclude" text[] DEFAULT '{}' NOT NULL,
	"max_bytes" integer NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_links_pkey" PRIMARY KEY("org","namespace")
);
--> statement-breakpoint
CREATE TABLE "api"."index_stamps" (
	"org" text NOT NULL,
	"index" text NOT NULL,
	"branch" text NOT NULL,
	"commit" text NOT NULL,
	"version" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_stamps_pkey" PRIMARY KEY("org","index","branch","commit")
);
--> statement-breakpoint
ALTER TABLE "api"."index_link_branches" ADD CONSTRAINT "index_link_branches_link_fkey" FOREIGN KEY ("org","namespace") REFERENCES "api"."index_links"("org","namespace") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."index_links" ADD CONSTRAINT "index_links_namespace_fkey" FOREIGN KEY ("org","namespace") REFERENCES "api"."namespaces"("org","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."index_links" ADD CONSTRAINT "index_links_index_fkey" FOREIGN KEY ("org","index") REFERENCES "api"."indexes"("org","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."index_stamps" ADD CONSTRAINT "index_stamps_index_fkey" FOREIGN KEY ("org","index") REFERENCES "api"."indexes"("org","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_link_branches_due" ON "api"."index_link_branches" USING btree ("due") WHERE dirty;--> statement-breakpoint
CREATE INDEX "index_link_branches_checked" ON "api"."index_link_branches" USING btree ("checked");--> statement-breakpoint
CREATE INDEX "index_stamps_newest" ON "api"."index_stamps" USING btree ("org","index","branch","at");