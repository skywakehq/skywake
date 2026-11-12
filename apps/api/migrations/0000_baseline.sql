-- The tables as they were before migrations. Every statement is skipped
-- when what it makes exists already, so a database made before then is
-- adopted as it is. Later migrations are written by `pnpm db:generate`.
CREATE SCHEMA IF NOT EXISTS "api";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."branches" (
	"org" text NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	"forked_from" text,
	"protected" boolean DEFAULT false NOT NULL,
	"head" text,
	"updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_pkey" PRIMARY KEY("org","namespace","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."claims" (
	"org" text NOT NULL,
	"namespace" text NOT NULL,
	"branch" text NOT NULL,
	"path" text NOT NULL,
	"session" text NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_pkey" PRIMARY KEY("org","namespace","branch","path")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."commits" (
	"org" text NOT NULL,
	"namespace" text NOT NULL,
	"branch" text NOT NULL,
	"hash" text NOT NULL,
	"parent" text,
	"message" text NOT NULL,
	"session" text,
	"merged" text,
	"actor" text NOT NULL,
	"agent" text,
	"changes" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commits_pkey" PRIMARY KEY("org","namespace","branch","hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."environments" (
	"org" text NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_pkey" PRIMARY KEY("org","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org" text NOT NULL,
	"hash" "bytea" NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"namespaces" text NOT NULL,
	"expires" timestamp with time zone,
	"last_used" timestamp with time zone,
	"created" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."namespaces" (
	"org" text NOT NULL,
	"name" text NOT NULL,
	"folder" text NOT NULL,
	"region" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespaces_pkey" PRIMARY KEY("org","name"),
	CONSTRAINT "namespaces_folder_key" UNIQUE("folder")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org" text NOT NULL,
	"namespace" text NOT NULL,
	"label" text NOT NULL,
	"actor" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."branches" ADD CONSTRAINT "branches_org_namespace_fkey" FOREIGN KEY ("org","namespace") REFERENCES "api"."namespaces"("org","name") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."claims" ADD CONSTRAINT "claims_session_fkey" FOREIGN KEY ("session") REFERENCES "api"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."claims" ADD CONSTRAINT "claims_org_namespace_branch_fkey" FOREIGN KEY ("org","namespace","branch") REFERENCES "api"."branches"("org","namespace","name") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."commits" ADD CONSTRAINT "commits_org_namespace_branch_fkey" FOREIGN KEY ("org","namespace","branch") REFERENCES "api"."branches"("org","namespace","name") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."environments" ADD CONSTRAINT "environments_org_fkey" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."keys" ADD CONSTRAINT "keys_org_fkey" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."namespaces" ADD CONSTRAINT "namespaces_org_fkey" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api"."sessions" ADD CONSTRAINT "sessions_org_namespace_fkey" FOREIGN KEY ("org","namespace") REFERENCES "api"."namespaces"("org","name") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_by_org" ON "api"."audit" USING btree ("org","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commits_by_time" ON "api"."commits" USING btree ("org","namespace","at");