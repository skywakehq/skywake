CREATE TABLE "api"."sso_domains" (
	"org" text NOT NULL,
	"domain" text NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_domains_pkey" PRIMARY KEY("org","domain")
);
--> statement-breakpoint
ALTER TABLE "api"."sso_domains" ADD CONSTRAINT "sso_domains_org_fkey" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sso_domains_by_domain" ON "api"."sso_domains" USING btree ("domain");