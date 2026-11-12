CREATE TABLE "api"."billing_accounts" (
	"org" text PRIMARY KEY NOT NULL,
	"customer" text,
	"subscription" text,
	"plan" text,
	"next_plan" text,
	"status" text,
	"started_at" timestamp with time zone,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"ended_at" timestamp with time zone,
	"past_due_since" timestamp with time zone,
	"override" text,
	"updated" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_customer_key" UNIQUE("customer")
);
--> statement-breakpoint
CREATE TABLE "api"."billing_reports" (
	"org" text NOT NULL,
	"meter" text NOT NULL,
	"subscription" text NOT NULL,
	"next" timestamp with time zone NOT NULL,
	"remainder" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "billing_reports_pkey" PRIMARY KEY("org","meter")
);
--> statement-breakpoint
CREATE TABLE "api"."billing_usage" (
	"org" text NOT NULL,
	"meter" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "billing_usage_pkey" PRIMARY KEY("org","meter","hour")
);
--> statement-breakpoint
ALTER TABLE "api"."index_usage" ADD COLUMN "bytes_written" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."index_usage" ADD COLUMN "bytes_scanned" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."billing_accounts" ADD CONSTRAINT "billing_accounts_org_orgs_id_fk" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."billing_reports" ADD CONSTRAINT "billing_reports_org_orgs_id_fk" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."billing_usage" ADD CONSTRAINT "billing_usage_org_orgs_id_fk" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;