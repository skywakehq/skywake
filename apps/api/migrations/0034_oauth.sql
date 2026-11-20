CREATE TABLE "api"."oauth_codes" (
	"hash" "bytea" PRIMARY KEY NOT NULL,
	"org" text NOT NULL,
	"client" text NOT NULL,
	"redirect" text NOT NULL,
	"challenge" text NOT NULL,
	"device" text NOT NULL,
	"role" text NOT NULL,
	"environment" text,
	"only" text[] NOT NULL,
	"orgs" text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_by_email" text,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api"."oauth_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"org" text NOT NULL,
	"client" text NOT NULL,
	"device" text NOT NULL,
	"role" text NOT NULL,
	"environment" text,
	"only" text[] NOT NULL,
	"orgs" text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_by_email" text,
	"key_id" text NOT NULL,
	"refresh_hash" "bytea" NOT NULL,
	"previous_hash" "bytea",
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."oauth_codes" ADD CONSTRAINT "oauth_codes_org_fkey" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."oauth_grants" ADD CONSTRAINT "oauth_grants_org_fkey" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_codes_expires" ON "api"."oauth_codes" USING btree ("expires");--> statement-breakpoint
CREATE INDEX "oauth_grants_expires" ON "api"."oauth_grants" USING btree ("expires");